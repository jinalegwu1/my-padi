package expo.modules.padivoice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.AudioAttributes
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.net.Uri
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.jni.NativeArrayBuffer
import java.nio.ByteBuffer
import java.util.concurrent.Executors

/** Foreground VOICE_COMMUNICATION capture, using OS acoustic echo cancellation. */
class PadiVoiceModule : Module() {
  @Volatile private var active = false
  private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  private var echo: AcousticEchoCanceler? = null
  private var noise: NoiseSuppressor? = null
  private var manager: AudioManager? = null
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeaker = false
  private var generation = 0
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var playbackGeneration = 0
  @Volatile private var track: AudioTrack? = null
  private val speechWriter = Executors.newSingleThreadExecutor()
  private var queuedFrames = 0
  private var telephonyListener: PhoneStateListener? = null

  override fun definition() = ModuleDefinition {
    Name("PadiVoice")
    Events("buffer", "interrupted", "callState")
    AsyncFunction("start") { startCapture() }
    Function("stop") { stopCapture() }
    Function("stopPlayback") { stopPlayback() }
    Function("beginQueuedPlayback") { beginQueuedPlayback() }
    AsyncFunction("enqueueAudio") { encoded: String, promise: Promise ->
      val started = playbackGeneration
      speechWriter.execute {
        try {
          if (!active || started != playbackGeneration) { promise.resolve(null); return@execute }
          val data = Base64.decode(encoded, Base64.DEFAULT)
          require(data.size > 44 && data.size <= 8 * 1024 * 1024 && String(data, 0, 4) == "RIFF")
          val output = synchronized(this) {
            if (started != playbackGeneration) null else track ?: makeSpeechTrack().also { track = it; it.play() }
          }
          if (output == null) { promise.resolve(null); return@execute }
          var offset = 44
          while (offset < data.size && active && started == playbackGeneration) {
            val written = output.write(data, offset, minOf(4096, data.size - offset), AudioTrack.WRITE_BLOCKING)
            if (written <= 0) throw IllegalStateException("Audio output interrupted")
            offset += written
          }
          val endFrame = synchronized(this) {
            if (started != playbackGeneration) null else {
              queuedFrames += (data.size - 44) / 2
              queuedFrames
            }
          }
          if (endFrame == null) { promise.resolve(null); return@execute }
          // Completion tracking never blocks the writer from filling the next
          // buffer. All clips use the same streaming AudioTrack.
          Thread({
            while (active && started == playbackGeneration && output.playbackHeadPosition < endFrame) Thread.sleep(10)
            promise.resolve(null)
          }, "PadiVoiceClipCompletion").start()
        } catch (error: Exception) {
          if (started != playbackGeneration) promise.resolve(null)
          else promise.reject("ERR_VOICE_PLAYBACK", "PADI playback failed.", error)
        }
      }
    }
    AsyncFunction("finishQueuedPlayback") { promise: Promise ->
      val started = playbackGeneration
      speechWriter.execute {
        try {
          val output = track
          while (output != null && active && started == playbackGeneration && output.playbackHeadPosition < queuedFrames) Thread.sleep(10)
          synchronized(this) { if (started == playbackGeneration) stopPlayback() }
          promise.resolve(null)
        } catch (error: Exception) { promise.reject("ERR_VOICE_PLAYBACK", "PADI playback failed.", error) }
      }
    }
    AsyncFunction("dial") { phone: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Phone context unavailable")
      val normalized = phone.filter { it.isDigit() || it == '+' }
      if (normalized.isBlank()) throw IllegalArgumentException("A valid phone number is required")
      val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$normalized")).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
      null
    }
    AsyncFunction("answerIncomingCall") {
      val context = appContext.reactContext ?: throw IllegalStateException("Phone context unavailable")
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) throw IllegalStateException("Answering calls is not supported on this Android version")
      if (context.checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("Phone call answering permission is required")
      }
      val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      telecom.acceptRingingCall()
      null
    }
    AsyncFunction("playMedia") { query: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Media context unavailable")
      val trimmed = query.trim()
      if (trimmed.isEmpty()) throw IllegalArgumentException("A music search is required")
      val encoded = Uri.encode(trimmed)
      val candidates = listOf(
        Intent(Intent.ACTION_VIEW, Uri.parse("spotify:search:$encoded")).apply { setPackage("com.spotify.music") },
        Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube://music/search?q=$encoded")).apply { setPackage("com.google.android.apps.youtube.music") },
        Intent(Intent.ACTION_VIEW, Uri.parse("https://music.youtube.com/search?q=$encoded")),
      )
      val intent = candidates.firstOrNull { context.packageManager.resolveActivity(it, 0) != null }
        ?: throw IllegalStateException("No supported music app is available")
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      null
    }
    OnActivityEntersForeground { startCallListener() }
    AsyncFunction("play") { encoded: String, promise: Promise ->
      stopPlayback()
      val started = playbackGeneration
      Thread({
        try { playAudio(encoded, started); promise.resolve(null) }
        catch (error: Exception) {
          if (started != playbackGeneration) promise.resolve(null)
          else promise.reject("ERR_VOICE_PLAYBACK", "PADI playback failed.", error)
        }
      }, "PadiVoicePlayback").start()
    }
    OnDestroy { stopCapture(); stopCallListener(); speechWriter.shutdownNow() }
  }

  private fun startCallListener() {
    val context = appContext.reactContext ?: return
    if (context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return
    if (telephonyListener != null) return
    val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    telephonyListener = object : PhoneStateListener() {
      override fun onCallStateChanged(state: Int, incomingNumber: String?) {
        val name = when (state) {
          TelephonyManager.CALL_STATE_RINGING -> "ringing"
          TelephonyManager.CALL_STATE_OFFHOOK -> "offhook"
          else -> "idle"
        }
        sendEvent("callState", mapOf("state" to name, "incomingNumber" to (incomingNumber ?: "")))
      }
    }
    telephony.listen(telephonyListener, PhoneStateListener.LISTEN_CALL_STATE)
  }

  private fun stopCallListener() {
    val context = appContext.reactContext ?: return
    val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    telephonyListener?.let { telephony.listen(it, PhoneStateListener.LISTEN_NONE) }
    telephonyListener = null
  }

  @Synchronized private fun startCapture(): Map<String, Any> {
    stopCapture()
    val context = appContext.reactContext ?: throw IllegalStateException("Voice context unavailable")
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw SecurityException("Microphone permission is required")
    }
    val rate = listOf(16000, 48000, 44100).firstOrNull {
      AudioRecord.getMinBufferSize(it, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT) > 0
    } ?: throw IllegalStateException("Microphone format unavailable")
    val frameBytes = rate / 20 * 2
    val minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val wakeIntent = Intent(context, PadiWakeService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(wakeIntent)
    else context.startService(wakeIntent)
    manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    previousMode = manager!!.mode
    previousSpeaker = manager!!.isSpeakerphoneOn
    try {
      manager!!.mode = AudioManager.MODE_IN_COMMUNICATION
      manager!!.isSpeakerphoneOn = true
      val audio = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, rate,
        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, frameBytes * 4))
      recorder = audio
      if (audio.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("Microphone initialization failed")
      if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(audio.audioSessionId)?.apply { enabled = true }
      if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(audio.audioSessionId)?.apply { enabled = true }
      audio.startRecording()
      active = true
      val started = ++generation
      worker = Thread({
        try {
          while (active && generation == started) {
            val data = ByteBuffer.allocateDirect(frameBytes)
            val count = audio.read(data, frameBytes, AudioRecord.READ_BLOCKING)
            if (count <= 0) throw IllegalStateException("Microphone stream interrupted")
            data.limit(count)
            val buffer = NativeArrayBuffer(data)
            main.post { if (active && generation == started) sendEvent("buffer", mapOf("data" to buffer, "sampleRate" to rate, "channels" to 1)) }
          }
        } catch (_: Exception) {
          main.post { if (active && generation == started) { stopCapture(); sendEvent("interrupted", mapOf("reason" to "microphone")) } }
        }
      }, "PadiVoiceCapture").apply { start() }
      return mapOf("echoCancellation" to (echo?.enabled == true), "sampleRate" to rate)
    } catch (error: Exception) { stopCapture(); throw error }
  }

  @Synchronized private fun stopCapture() {
    stopPlayback()
    val context = appContext.reactContext
    active = false
    generation++
    try { recorder?.stop() } catch (_: Exception) {}
    worker?.join(500)
    worker = null
    recorder?.release(); recorder = null
    echo?.release(); echo = null
    noise?.release(); noise = null
    manager?.let { it.mode = previousMode; it.isSpeakerphoneOn = previousSpeaker }
    manager = null
    context?.stopService(Intent(context, PadiWakeService::class.java))
  }

  @Synchronized private fun stopPlayback() {
    playbackGeneration++
    val audio = track; track = null
    try { audio?.pause(); audio?.flush(); audio?.stop(); audio?.release() } catch (_: Exception) {}
  }

  @Synchronized private fun beginQueuedPlayback() { stopPlayback(); queuedFrames = 0 }

  private fun playAudio(encoded: String, started: Int) {
    val data = Base64.decode(encoded, Base64.DEFAULT)
    if (data.size <= 44 || data.size > 8 * 1024 * 1024 || !active || started != playbackGeneration) return
    val output = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      .setBufferSizeInBytes(maxOf(24000, AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)))
      .setTransferMode(AudioTrack.MODE_STREAM).build()
    synchronized(this) { if (started != playbackGeneration) { output.release(); return }; track = output }
    try {
      output.play()
      var offset = 44
      while (offset < data.size && active && started == playbackGeneration) {
        val written = output.write(data, offset, minOf(4096, data.size-offset), AudioTrack.WRITE_BLOCKING)
        if (written <= 0) throw IllegalStateException("Audio output interrupted")
        offset += written
      }
      val frames = (data.size-44)/2
      while (active && started == playbackGeneration && output.playbackHeadPosition < frames) Thread.sleep(20)
    } finally { synchronized(this) { if (track === output) { track = null; output.stop(); output.release() } } }
  }

  private fun makeSpeechTrack() = AudioTrack.Builder()
    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(24000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
    .setBufferSizeInBytes(maxOf(24000, AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)))
    .setTransferMode(AudioTrack.MODE_STREAM).build()
}
