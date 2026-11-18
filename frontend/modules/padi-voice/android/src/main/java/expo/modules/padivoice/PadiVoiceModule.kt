package expo.modules.padivoice

import android.Manifest
import android.content.Context
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
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.jni.NativeArrayBuffer
import java.nio.ByteBuffer

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

  override fun definition() = ModuleDefinition {
    Name("PadiVoice")
    Events("buffer", "interrupted")
    AsyncFunction("start") { startCapture() }
    Function("stop") { stopCapture() }
    Function("stopPlayback") { stopPlayback() }
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
    OnActivityEntersBackground { stopCapture(); sendEvent("interrupted", mapOf("reason" to "background")) }
    OnDestroy { stopCapture() }
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
  }

  @Synchronized private fun stopPlayback() {
    playbackGeneration++
    val audio = track; track = null
    try { audio?.pause(); audio?.flush(); audio?.stop(); audio?.release() } catch (_: Exception) {}
  }

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
}
