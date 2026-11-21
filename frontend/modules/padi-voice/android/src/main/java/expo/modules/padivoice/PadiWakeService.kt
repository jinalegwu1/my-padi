package expo.modules.padivoice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class PadiWakeService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = if (launch != null) {
      PendingIntent.getActivity(this, 1001, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    } else null
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("PADI is listening")
      .setContentText("Say Hey PADI or PADI. Turn this off in PADI settings.")
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .apply { if (pending != null) setContentIntent(pending) }
      .build()
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int =
    START_STICKY

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(CHANNEL_ID, "PADI wake listening", NotificationManager.IMPORTANCE_LOW)
    channel.description = "Shows while PADI is available for Hey PADI or PADI."
    channel.setSound(null, null)
    manager.createNotificationChannel(channel)
  }

  companion object {
    const val CHANNEL_ID = "padi-wake-listening"
    const val NOTIFICATION_ID = 4201
  }
}
