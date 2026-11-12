// Me.Plan 폰 알림 — GitHub 자동 작업이 하루 3번(한국 9시·18시·22시) 실행
import admin from "firebase-admin";

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore(), fcm = admin.messaging();

// 어느 시간대인지: 수동 실행이면 SLOT, 아니면 지금 시각(UTC)으로 판단
const kstNow = new Date(Date.now() + 9 * 3600e3);
const hUTC = new Date().getUTCHours();
const slot = process.env.SLOT || (hUTC >= 22 || hUTC < 4 ? "m" : hUTC < 11 ? "e" : "n");

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const today = ymd(kstNow), tomorrow = ymd(new Date(kstNow.getTime() + 864e5));
const dow = kstNow.getUTCDay(), dowT = (dow + 1) % 7;
const nowHM = `${pad(kstNow.getUTCHours())}:${pad(kstNow.getUTCMinutes())}`;

const mondayOf = d => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return ymd(x); };
const periodKey = it => it.repeat === "weekly" ? "W" + mondayOf(kstNow) : it.repeat === "monthly" ? "M" + today.slice(0, 7) : today;
const eventsOn = (ev, ds) => ev.filter(e => e.date <= ds && ((e.endDate && e.endDate >= e.date) ? e.endDate : e.date) >= ds)
  .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
const classesOn = (cs, d) => cs.flatMap(c => (c.slots || []).filter(s => s.day === d).map(s => ({ title: c.name, time: s.start }))).sort((a, b) => a.time.localeCompare(b.time));
const cut = (arr, n = 3) => arr.slice(0, n).join(", ") + (arr.length > n ? ` 외 ${arr.length - n}개` : "");

function compose(items) {
  const all = k => items.filter(i => i.kind === k);
  const ev = all("event"), cs = all("course"), tasks = all("task");
  const routines = all("check").filter(i => i.repeat && i.repeat !== "none" && (i.repeat !== "days" || (i.days || []).includes(dow)));
  const todayEv = eventsOn(ev, today), todayCl = classesOn(cs, dow);
  const todayTasks = tasks.filter(t => t.date <= today && !t.done);
  const leftRoutines = routines.filter(r => r.doneKey !== periodKey(r));
  const firstOf = list => list.filter(x => x.time)[0];

  if (slot === "m") {
    const sched = [...todayCl, ...todayEv].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    const parts = [sched.length && `일정 ${sched.length}`, todayTasks.length && `할 일 ${todayTasks.length}`, leftRoutines.length && `루틴 ${leftRoutines.length}`].filter(Boolean);
    if (!parts.length) return { title: "좋은 아침! ☀️", body: "오늘은 일정이 비어 있어. 여유로운 하루 보내!" };
    const first = firstOf(sched);
    return { title: "좋은 아침! 오늘의 Me.Plan ☀️", body: parts.join(" · ") + (first ? `\n첫 일정 ${first.time} ${first.title}` : "") };
  }
  if (slot === "e") {
    const later = eventsOn(ev, today).filter(e => e.time && e.time >= nowHM);
    const lines = [];
    if (todayTasks.length) lines.push(`남은 할 일 ${todayTasks.length}개: ${cut(todayTasks.map(t => t.title))}`);
    if (leftRoutines.length) lines.push(`남은 루틴 ${leftRoutines.length}개`);
    if (later.length) lines.push(`이따 ${later[0].time} ${later[0].title}`);
    if (!lines.length) return null;
    return { title: "저녁 체크 🌇", body: lines.join("\n") };
  }
  // 밤
  const lines = [];
  if (todayTasks.length) lines.push(`못 끝낸 할 일 ${todayTasks.length}개는 내일로 넘어가: ${cut(todayTasks.map(t => t.title))}`);
  if (leftRoutines.length) lines.push(`아직 안 한 루틴: ${cut(leftRoutines.map(r => r.title))}`);
  const tmr = firstOf([...classesOn(cs, dowT), ...eventsOn(ev, tomorrow)].sort((a, b) => (a.time || "").localeCompare(b.time || "")));
  if (tmr) lines.push(`내일 첫 일정 ${tmr.time} ${tmr.title}`);
  if (!lines.length) return { title: "오늘도 수고했어 🌙", body: "오늘 할 일을 다 끝냈어. 푹 쉬어!" };
  return { title: "하루 마무리 🌙", body: lines.join("\n") };
}

let sent = 0, users = 0;
for (const userRef of await db.collection("users").listDocuments()) {
  const snap = await userRef.collection("items").get();
  const items = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  const settings = items.find(i => i.id === "settings") || {};
  if (!(settings.pushTimes || {})[slot]) continue;
  const devices = items.filter(i => i.kind === "push" && i.token);
  if (!devices.length) continue;
  users++;
  const msg = compose(items);
  if (!msg) continue;
  for (const d of devices) {
    try {
      await fcm.send({ token: d.token, data: { title: msg.title, body: msg.body, tag: "meplan-" + slot, url: "./" }, webpush: { headers: { Urgency: "high", TTL: "21600" } } });
      sent++;
    } catch (e) {
      if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(e.code)) await d.ref.delete();
      else console.error("send failed", e.code || e.message);
    }
  }
}
console.log(`slot=${slot} users=${users} sent=${sent}`);
