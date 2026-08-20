const { Platform } = require("react-native");

// A daily nudge, scheduled by the OS rather than by us: nothing of ours runs while the app is
// closed, which is why the reminder cannot say how many words are due. That number is fixed at
// scheduling time and would be wrong the moment a review happened on the desktop — so it says
// that it is time, not how much is waiting.
// ponytail: a background task could refresh the count, but that needs a development build and a
// native rebuild cycle for what is, in the end, a nudge.
//
// expo-notifications is treated as OPTIONAL, and that is the important part. Android's Expo Go
// dropped the module in SDK 53, and requiring it at the top of this file took the whole app down
// before it rendered a single screen. A reminder is a convenience; it must never be able to stop
// the app from starting. So the module is loaded on demand, inside a try, and every entry point
// answers with { ok } rather than throwing.
const CHANNEL = "review";
let N = null;
let ready = false;

function load() {
  if (N) return N;
  N = require("expo-notifications");
  if (!ready) {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    ready = true;
  }
  return N;
}

const UNAVAILABLE = "這個執行環境不支援通知（Android 版 Expo Go 從 SDK 53 起移除），需要獨立打包的 app";

// Android 8+ refuses any notification that is not assigned to a channel.
async function ensureChannel(n) {
  if (Platform.OS !== "android") return;
  await n.setNotificationChannelAsync(CHANNEL, {
    name: "複習提醒",
    importance: n.AndroidImportance.DEFAULT,
  });
}

// Evening by default, and the default matters: the whole scheduler is built on the idea that
// sleep is what an interval means (dues land on the 4am rollover). Reviewing before bed is the
// pattern the curve already assumes.
async function enableDaily(hour) {
  let n;
  try {
    n = load();
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
  try {
    const { status } = await n.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    if (status !== "granted") return { ok: false, error: "系統沒有給通知權限" };
    await ensureChannel(n);
    // Exactly one reminder exists at a time; cancelling first is simpler than tracking
    // identifiers across reinstalls, and this app schedules nothing else.
    await n.cancelAllScheduledNotificationsAsync();
    await n.scheduleNotificationAsync({
      content: { title: "immerse", body: "該複習了 — 看看今天哪些字到期" },
      trigger: {
        type: n.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute: 0,
        channelId: CHANNEL,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function disableDaily() {
  try {
    await load().cancelAllScheduledNotificationsAsync();
    return { ok: true };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

// What the OS actually holds, not what we think we asked for — a reinstall, a revoked permission
// or an OS cleanup can drop the schedule without telling the app.
async function scheduledCount() {
  try {
    return (await load().getAllScheduledNotificationsAsync()).length;
  } catch {
    return 0;
  }
}

module.exports = { enableDaily, disableDaily, scheduledCount };
