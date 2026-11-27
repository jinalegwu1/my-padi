import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { MemoryConsentDialog } from '@/components/memory/memory-consent-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { fonts, radius, spacing, useColors, useType } from '@/constants/theme';
import { MEMORY_CATEGORY_META, MEMORY_CATEGORY_ORDER } from '@/data/mock-memory';
import { useMemory } from '@/hooks/use-memory';
import { useTranslation } from '@/hooks/use-translation';
import { formatRelative } from '@/lib/date';
import { readJSON } from '@/lib/storage';
import { preferenceDraft } from '../../public/padi-chat/preference-review';
import type { Message, MemoryCategory, MemoryItem } from '@/types';

/**
 * Memory management: review, correct, pause and delete what PADI remembers.
 * Nothing is collected automatically — every entry came from the user.
 */
export default function MemoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const type = useType();
  const { t } = useTranslation();
  const { accountID, enabled, items, grouped, counts, status, busy, error, reload, add, correct, togglePaused, remove, setEnabled } = useMemory();

  const [editing, setEditing] = useState<MemoryItem | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MemoryItem | undefined>(undefined);
  const [editorOpen, setEditorOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [category, setCategory] = useState<MemoryCategory>('preferences');
  const [label, setLabel] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogAccountID, setDialogAccountID] = useState<string | null>(null);

  useEffect(() => {
    setEditing(undefined);
    setEditorOpen(false);
    setConsentOpen(false);
    setPendingDelete(undefined);
    setDraft('');
    setLabel('');
    setNotice('');
    setDialogAccountID(null);
  }, [accountID]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const { message: messageID } = useLocalSearchParams<{ message?: string }>();
  const reviewed = useRef('');
  useEffect(() => {
    let active = true;
    if (status !== 'ready' || !accountID || typeof messageID !== 'string') return;
    const key = accountID + '/' + messageID;
    if (reviewed.current === key) return;
    void readJSON<Message[]>('chat-messages', []).then(messages => {
      if (!active) return;
      const suggestion = preferenceDraft(messages.find(m => m.id === messageID && m.backendUserID === accountID), accountID);
      if (!suggestion) return;
      if (!enabled) {
        setNotice('Turn on personal memory to review and save this preference.');
        return;
      }
      reviewed.current = key;
      if (items.some(item => item.category === 'preferences' && item.value === suggestion.value)) {
        setNotice('This preference is already in your memory.');
        return;
      }
      setNotice('');
      setDialogAccountID(accountID);
      setEditing(undefined);
      setCategory('preferences');
      setLabel(suggestion.label);
      setDraft(suggestion.value);
      setEditorOpen(true);
    }).catch(() => { if (active) setNotice('The original chat message could not be opened.'); });
    return () => { active = false; };
  }, [accountID, enabled, items, status, messageID]);

  const save = async () => {
    const saved = editing
      ? await correct(editing.id, draft.trim())
      : await add({ category, label: label.trim(), value: draft.trim() });
    if (saved) {
      setNotice(editing ? 'Memory updated.' : 'Memory saved. PADI can use it when relevant.');
      setEditorOpen(false);
      setEditing(undefined);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.back')}
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/settings'); }}
          hitSlop={10}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: colors.cardMuted },
            pressed && { opacity: 0.7 },
          ]}>
          <Ionicons name="arrow-back" size={19} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.title }]}>
            {t('memory.title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted, fontSize: type.caption }]}>
            {t('memory.subtitle')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* Consent banner */}
        <View
          style={[
            styles.consent,
            {
              backgroundColor: enabled ? colors.successSoft : colors.warningSoft,
              borderColor: colors.border,
            },
          ]}>
          <Ionicons
            name={enabled ? 'shield-checkmark-outline' : 'pause-circle-outline'}
            size={18}
            color={enabled ? colors.success : colors.warning}
          />
          <View style={styles.consentText}>
            <Text
              style={[
                styles.consentTitle,
                {
                  color: enabled ? colors.success : colors.warning,
                  fontSize: type.bodySmall,
                },
              ]}>
              {enabled ? 'Personal memory is on' : 'Personal memory is off'}
            </Text>
            <Text style={[styles.consentBody, { color: colors.textSecondary, fontSize: type.micro }]}>
              {counts.active} in use · {counts.paused} paused · {counts.total} total
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.masterRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}>
          <Text style={[styles.masterLabel, { color: colors.text, fontSize: type.body }]}>
            Allow PADI to remember
          </Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: enabled, disabled: busy || status !== 'ready' }}
            accessibilityLabel="Allow PADI to remember"
            disabled={busy || status !== 'ready'}
            onPress={async () => {
              if (!enabled) { setDialogAccountID(accountID); setConsentOpen(true); }
              else if (await setEnabled(false)) setNotice('Personal memory is off. Saved facts will not be used for new replies.');
            }}
            style={({ pressed }) => [
              styles.masterButton,
              {
                backgroundColor: enabled ? colors.primary : colors.cardMuted,
                borderColor: enabled ? colors.primary : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            <Text
              style={[
                styles.masterButtonText,
                {
                  color: enabled ? colors.onPrimary : colors.textSecondary,
                  fontSize: type.caption,
                },
              ]}>
              {enabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.consentBody, { color: colors.textSecondary, fontSize: type.caption }]}>
          PADI uses your account name and selected country in chat. Personal memories are saved and used with your approval. After a memory change, PADI starts fresh with the saved facts currently allowed. Previous messages stay visible. Changes affect the next request.
        </Text>
        {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
        {error && status === 'ready' ? <Button title="Reload memory" variant="secondary" disabled={busy} onPress={() => { void reload(); }} /> : null}
        {notice && !error ? <Text accessibilityRole="text" style={{ color: colors.success }}>{notice}</Text> : null}
        {status === 'unauthorized' ? (
          <Button title="Sign in to manage memory" onPress={() => router.push('/auth')} />
        ) : status === 'error' ? (
          <Button title="Retry loading memory" onPress={() => { void reload(); }} />
        ) : (
          <Button
            title="Add memory"
            icon="add"
            disabled={!enabled || busy}
            onPress={() => { setDialogAccountID(accountID); setEditing(undefined); setDraft(''); setLabel(''); setCategory('preferences'); setEditorOpen(true); setNotice(''); }}
          />
        )}

        {grouped.length === 0 ? (
          <EmptyState
            icon="sparkles-outline"
            title={t('memory.empty')}
            message="Enable memory, then choose Add memory to review and approve a fact. PADI does not automatically save conversations or import demo entries."
          />
        ) : (
          grouped.map((group) => {
            const meta = MEMORY_CATEGORY_META[group.category];
            return (
              <View key={group.category} style={styles.group}>
                <View style={styles.groupHeader}>
                  <View style={[styles.groupIcon, { backgroundColor: colors.accentSoft }]}>
                    <Ionicons name={meta.icon} size={16} color={colors.accent} />
                  </View>
                  <View style={styles.groupText}>
                    <Text style={[styles.groupTitle, { color: colors.text, fontSize: type.subheading }]}>
                      {meta.label}
                    </Text>
                    <Text style={[styles.groupDesc, { color: colors.muted, fontSize: type.micro }]}>
                      {meta.description}
                    </Text>
                  </View>
                </View>

                {group.items.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.item,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        opacity: item.paused || !enabled ? 0.7 : 1,
                      },
                    ]}>
                    <View style={styles.itemTop}>
                      <Text style={[styles.itemLabel, { color: colors.muted, fontSize: type.micro }]}>
                        {item.label.toUpperCase()}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor: item.paused || !enabled ? colors.cardMuted : colors.successSoft,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.statusText,
                            {
                              color: item.paused || !enabled ? colors.muted : colors.success,
                              fontSize: type.micro,
                            },
                          ]}>
                      {item.paused ? t('memory.paused') : !enabled ? 'Not in use' : t('memory.active')}
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={[
                        styles.itemValue,
                        {
                          color: colors.text,
                          fontSize: type.body,
                          lineHeight: type.lineHeight(type.body),
                        },
                      ]}>
                      {item.value}
                    </Text>

                    <Text style={[styles.itemSource, { color: colors.muted, fontSize: type.micro }]}>
                      {t('memory.source')}: {item.source} · {formatRelative(item.createdAt)}
                    </Text>

                    <View style={styles.itemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('memory.correct')}: ${item.label}`}
                        disabled={busy}
                        onPress={() => {
                          setEditing(item);
                          setDialogAccountID(accountID);
                          setDraft(item.value);
                          setEditorOpen(true);
                        }}
                        style={({ pressed }) => [
                          styles.action,
                          { backgroundColor: colors.cardMuted, opacity: pressed ? 0.7 : 1 },
                        ]}>
                        <Ionicons name="create-outline" size={14} color={colors.textSecondary} />
                        <Text
                          style={[styles.actionText, { color: colors.textSecondary, fontSize: type.micro }]}>
                          {t('memory.correct')}
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.paused ? t('memory.resume') : t('memory.pause')}: ${item.label}`}
                        disabled={busy}
                        onPress={async () => {
                          if (await togglePaused(item.id)) setNotice(item.paused ? 'Memory resumed.' : 'Memory paused.');
                        }}
                        style={({ pressed }) => [
                          styles.action,
                          { backgroundColor: colors.cardMuted, opacity: pressed ? 0.7 : 1 },
                        ]}>
                        <Ionicons
                          name={item.paused ? 'play-outline' : 'pause-outline'}
                          size={14}
                          color={colors.textSecondary}
                        />
                        <Text
                          style={[styles.actionText, { color: colors.textSecondary, fontSize: type.micro }]}>
                          {item.paused ? t('memory.resume') : t('memory.pause')}
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('memory.delete')}: ${item.label}`}
                        disabled={busy}
                        onPress={() => { setDialogAccountID(accountID); setPendingDelete(item); }}
                        style={({ pressed }) => [
                          styles.action,
                          { backgroundColor: colors.dangerSoft, opacity: pressed ? 0.7 : 1 },
                        ]}>
                        <Ionicons name="trash-outline" size={14} color={colors.danger} />
                        <Text style={[styles.actionText, { color: colors.danger, fontSize: type.micro }]}>
                          {t('memory.delete')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      <Sheet
        visible={editorOpen && dialogAccountID === accountID}
        title={editing ? t('memory.editTitle') : 'Add a memory'}
        subtitle={editing?.label}
        onClose={() => { if (!busy) { setEditorOpen(false); setEditing(undefined); } }}
        footer={
          <Button
            title={editing ? t('memory.save') : 'Save and approve memory'}
            icon="checkmark"
            onPress={save}
            loading={busy}
            disabled={busy || !draft.trim() || (!editing && !label.trim())}
          />
        }>
        {!editing ? (
          <>
            <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
              {MEMORY_CATEGORY_ORDER.map((choice) => (
                <Button key={choice} title={MEMORY_CATEGORY_META[choice].label} variant={category === choice ? 'primary' : 'secondary'} disabled={busy}
                  onPress={() => setCategory(choice)} />
              ))}
            </View>
            <TextField label="Memory label" value={label} onChangeText={setLabel} maxLength={100} editable={!busy} placeholder="e.g. Favourite food" />
            <Text style={[styles.consentBody, { color: colors.textSecondary, fontSize: type.caption, marginVertical: spacing.sm }]}>
              By saving, you approve keeping this fact in your account and using it in relevant AI replies while memory is on.
            </Text>
          </>
        ) : null}
        <TextField
          label={t('memory.correct')}
          value={draft}
          onChangeText={setDraft}
          multiline
          numberOfLines={3}
          maxLength={500}
          editable={!busy}
          style={styles.editInput}
        />
        {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
      </Sheet>

      <ConfirmDialog
        visible={!!pendingDelete && dialogAccountID === accountID}
        title={t('memory.deleteTitle')}
        message={error ?? t('memory.deleteBody')}
        confirmTitle={t('common.delete')}
        cancelTitle={t('common.cancel')}
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={async () => {
          if (pendingDelete && await remove(pendingDelete.id)) {
            setPendingDelete(undefined);
            setNotice('Memory deleted.');
          }
        }}
      />
      <MemoryConsentDialog visible={consentOpen} accountID={dialogAccountID} onClose={() => setConsentOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.extrabold, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxxl, gap: spacing.base },
  consent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
  },
  consentText: { flex: 1, gap: 2 },
  consentTitle: { fontFamily: fonts.semibold, lineHeight: 19 },
  consentBody: { fontFamily: fonts.regular },
  masterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  masterLabel: { flex: 1, fontFamily: fonts.medium },
  masterButton: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  masterButtonText: { fontFamily: fonts.semibold },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  groupIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupText: { flex: 1, gap: 1 },
  groupTitle: { fontFamily: fonts.semibold },
  groupDesc: { fontFamily: fonts.regular },
  item: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.sm,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemLabel: { fontFamily: fonts.bold, letterSpacing: 0.7 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusText: { fontFamily: fonts.semibold },
  itemValue: { fontFamily: fonts.regular },
  itemSource: { fontFamily: fonts.regular },
  itemActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionText: { fontFamily: fonts.semibold },
  editInput: { minHeight: 84, textAlignVertical: 'top' },
});
