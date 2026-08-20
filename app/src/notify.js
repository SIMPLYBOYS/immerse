const Notifications = require("expo-notifications");
const { Platform } = require("react-native");

// A daily nudge, scheduled by the OS rather than by us: nothing of ours runs while the app is
// closed, which is exactly why the reminder cannot say how many words are due. That number is
// fixed at scheduling time and would be wrong the moment a review happened on the desktop — so
// the notification says that it is time, not how much is waiting.
// ponytail: a background task could refresh the count, but that needs a development build and a
// native rebuild cycle for what is, in the end, a nudge.
const CHANNEL = "review";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Android 8+ refuses any notification that is not assigned to a channel.
async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: "複習提醒",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

// Evening by default, and the default matters: the whole scheduler is built on the idea that
// sleep is what an interval means (dues land on the 4am rollover). Reviewing before bed is the
// pattern the curve already assumes.
async function enableDaily(hour) {
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  if (status !== "granted") return { ok: false, error: "系統沒有給通知權限" };
  await ensureChannel();
  // Exactly one reminder exists at a time; cancelling first is simpler than tracking identifiers
  // across reinstalls, and this app schedules nothing else.
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: { title: "immerse", body: "該複習了 — 看看今天哪些字到期" },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
      channelId: CHANNEL,
    },
  });
  return { ok: true };
}

const disableDaily = () => Notifications.cancelAllScheduledNotificationsAsync();

// What the OS actually holds, not what we think we asked for — a reinstall, a revoked permission
// or an OS cleanup can drop the schedule without telling the app.
const scheduledCount = async () =>
  (await Notifications.getAllScheduledNotificationsAsync().catch(() => [])).length;

module.exports = { enableDaily, disableDaily, scheduledCount };
