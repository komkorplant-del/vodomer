/* Шлёт одно уведомление, если на текущую минуту приходится точка расписания.
   Запускается по cron каждые полчаса: сравнение идёт по времени Киева,
   поэтому переход на зимнее время ничего не ломает — расписание не съезжает. */
import webpush from "web-push";
import { readFileSync } from "node:fs";

const WINDOW_MIN = 29;              // точка считается наступившей в течение получаса после неё
const cfg = JSON.parse(readFileSync(new URL("../schedule.json", import.meta.url), "utf8"));

const { VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT, PUSH_SUBSCRIPTION } = process.env;

if (!PUSH_SUBSCRIPTION) {
  console.log("Подписки нет — уведомления ещё не включены на устройстве. Выходим без ошибки.");
  process.exit(0);
}
if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error("Нет ключей VAPID_PUBLIC / VAPID_PRIVATE в секретах репозитория.");
  process.exit(1);
}

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Текущее время в зоне расписания, без зависимости от зоны раннера.
const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: cfg.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
}).formatToParts(new Date());
const nowMin = Number(parts.find(p => p.type === "hour").value) * 60
             + Number(parts.find(p => p.type === "minute").value);

// Все точки суток: питьё по интервалу + витамины по своему времени.
const points = [];
for (let m = toMin(cfg.water.from); m <= toMin(cfg.water.to); m += cfg.water.everyMin) {
  points.push({ at: m, title: "Водомер", body: cfg.water.text });
}
for (const v of cfg.vitamins) {
  points.push({ at: toMin(v.time), title: "Витамины", body: v.text });
}

// Ближайшая точка, которая уже наступила и ещё не протухла.
const ready = points
  .filter(p => nowMin >= p.at && nowMin - p.at <= WINDOW_MIN)
  .sort((a, b) => b.at - a.at);
// Питьё и витамины могут попасть на одну минуту — тогда шлём одно письмо на двоих,
// иначе второе напоминание молча потерялось бы.
const same = ready.filter(p => ready[0] && p.at === ready[0].at);
const due = same.length > 1
  ? { at: same[0].at, title: "Водомер", body: same.map(p => p.body).join(". ") }
  : ready[0];

const hhmm = String(Math.floor(nowMin / 60)).padStart(2, "0") + ":" + String(nowMin % 60).padStart(2, "0");
if (!due) {
  console.log(`${hhmm} ${cfg.timezone} — ни одна точка расписания не подошла, ничего не шлём.`);
  process.exit(0);
}

webpush.setVapidDetails(VAPID_SUBJECT || "mailto:kondaurov.mind@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

const payload = JSON.stringify({ title: due.title, body: due.body, tag: "vodomer-" + due.at });

try {
  await webpush.sendNotification(JSON.parse(PUSH_SUBSCRIPTION), payload, { TTL: 1800 });
  console.log(`${hhmm} — отправлено: ${due.body}`);
} catch (e) {
  console.error(`${hhmm} — не отправлено: ${e.statusCode || ""} ${e.body || e.message}`);
  // 404/410 — подписка device'ом отозвана: её надо пересоздать в приложении.
  if (e.statusCode === 404 || e.statusCode === 410) {
    console.error("Подписка больше не действует. Включите уведомления в приложении заново и обновите секрет PUSH_SUBSCRIPTION.");
  }
  process.exit(1);
}
