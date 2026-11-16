package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
)

const (
	challengeLifetime = 5 * time.Minute
	sessionLifetime   = 30 * 24 * time.Hour
)

var (
	ErrRateLimited      = errors.New("authentication request rate limit reached")
	ErrInvalidChallenge = errors.New("invalid or expired verification code")
	ErrUnauthenticated  = errors.New("session is invalid or expired")
	ErrInvalidProfile   = errors.New("authentication profile is invalid")
)

type User struct {
	ID       string `json:"id"`
	FullName string `json:"full_name"`
}

type Session struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      User      `json:"user"`
}

type Challenge struct {
	ID          string
	PhoneNumber string
	FullName    string
	DateOfBirth string
	Purpose     string
	CodeHash    []byte
	ExpiresAt   time.Time
	SourceIP    string
}

type SessionRecord struct {
	TokenHash []byte
	UserID    string
	ExpiresAt time.Time
}

type Store interface {
	CreateChallenge(context.Context, Challenge) (bool, error)
	CancelChallenge(context.Context, string) error
	VerifyChallenge(context.Context, string, []byte, SessionRecord, time.Time) (User, error)
	ResolveSession(context.Context, []byte, time.Time) (User, error)
	RevokeSession(context.Context, []byte, time.Time) error
}

type CodeSender interface {
	SendCode(context.Context, string, string) error
}

type Service struct {
	store  Store
	sender CodeSender
	pepper []byte
	now    func() time.Time
}

func NewService(store Store, sender CodeSender, pepper []byte) (*Service, error) {
	if store == nil {
		return nil, errors.New("authentication store is required")
	}
	if sender == nil {
		return nil, errors.New("authentication code sender is required")
	}
	if len(pepper) < 32 {
		return nil, errors.New("PADI_AUTH_PEPPER must contain at least 32 bytes")
	}
	return &Service{store: store, sender: sender, pepper: append([]byte(nil), pepper...), now: time.Now}, nil
}

type ChallengeResult struct {
	ID      string
	Message string
}

func (service *Service) RequestRegistration(ctx context.Context, profile Profile, sourceIP string) (ChallengeResult, error) {
	normalized, err := NormalizeProfile(profile, service.now())
	if err != nil {
		return ChallengeResult{}, fmt.Errorf("%w: %v", ErrInvalidProfile, err)
	}
	return service.requestChallenge(ctx, Challenge{
		PhoneNumber: normalized.PhoneNumber,
		FullName:    normalized.FullName,
		DateOfBirth: normalized.DateOfBirth,
		Purpose:     "register",
		SourceIP:    sourceIP,
	})
}

func (service *Service) RequestLogin(ctx context.Context, phoneNumber, sourceIP string) (ChallengeResult, error) {
	if !ValidPhoneNumber(phoneNumber) {
		return ChallengeResult{}, fmt.Errorf("%w: phone number must use E.164 format", ErrInvalidProfile)
	}
	return service.requestChallenge(ctx, Challenge{
		PhoneNumber: phoneNumber,
		Purpose:     "login",
		SourceIP:    sourceIP,
	})
}

func (service *Service) requestChallenge(ctx context.Context, challenge Challenge) (ChallengeResult, error) {
	id, err := randomString(24)
	if err != nil {
		return ChallengeResult{}, fmt.Errorf("create authentication challenge: %w", err)
	}
	code, err := verificationCode()
	if err != nil {
		return ChallengeResult{}, fmt.Errorf("create verification code: %w", err)
	}
	now := service.now().UTC()
	challenge.ID = id
	challenge.CodeHash = service.codeHash(id, code)
	challenge.ExpiresAt = now.Add(challengeLifetime)

	eligible, err := service.store.CreateChallenge(ctx, challenge)
	if err != nil {
		return ChallengeResult{}, err
	}
	result := ChallengeResult{
		ID:      id,
		Message: "If the details are eligible, a verification code has been sent.",
	}
	if !eligible {
		return result, nil
	}
	if err := service.sender.SendCode(ctx, challenge.PhoneNumber, code); err != nil {
		if cancelErr := service.store.CancelChallenge(ctx, id); cancelErr != nil {
			return ChallengeResult{}, fmt.Errorf("send verification code: %w (also invalidate challenge: %v)", err, cancelErr)
		}
		return ChallengeResult{}, fmt.Errorf("send verification code: %w", err)
	}
	return result, nil
}

func (service *Service) Verify(ctx context.Context, challengeID, code string) (Session, error) {
	if challengeID == "" || len(code) > 32 {
		return Session{}, ErrInvalidChallenge
	}
	token, err := randomString(32)
	if err != nil {
		return Session{}, fmt.Errorf("create session token: %w", err)
	}
	userID, err := randomString(24)
	if err != nil {
		return Session{}, fmt.Errorf("create user id: %w", err)
	}
	expiresAt := service.now().UTC().Add(sessionLifetime)
	tokenHash := sha256.Sum256([]byte(token))
	user, err := service.store.VerifyChallenge(
		ctx,
		challengeID,
		service.codeHash(challengeID, code),
		SessionRecord{TokenHash: tokenHash[:], UserID: userID, ExpiresAt: expiresAt},
		service.now().UTC(),
	)
	if err != nil {
		return Session{}, err
	}
	return Session{Token: token, ExpiresAt: expiresAt, User: user}, nil
}

func (service *Service) Authenticate(ctx context.Context, token string) (User, error) {
	tokenBytes, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(tokenBytes) != 32 {
		return User{}, ErrUnauthenticated
	}
	hash := sha256.Sum256([]byte(token))
	user, err := service.store.ResolveSession(ctx, hash[:], service.now().UTC())
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (service *Service) Logout(ctx context.Context, token string) error {
	tokenBytes, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(tokenBytes) != 32 {
		return ErrUnauthenticated
	}
	hash := sha256.Sum256([]byte(token))
	return service.store.RevokeSession(ctx, hash[:], service.now().UTC())
}

func (service *Service) codeHash(challengeID, code string) []byte {
	mac := hmac.New(sha256.New, service.pepper)
	_, _ = mac.Write([]byte(challengeID))
	_, _ = mac.Write([]byte{':'})
	_, _ = mac.Write([]byte(code))
	return mac.Sum(nil)
}

func randomString(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func verificationCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func ValidVerificationCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	_, err := strconv.Atoi(code)
	return err == nil && strings.Trim(code, "0123456789") == ""
}
