// Live end-to-end smoke test against a RUNNING server over real HTTP.
// Exercises the same calls the browser makes, in the same order.
const BASE = "http://localhost:4000/api";
let cookies: string[] = [];

function cookieHeader() {
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function call(path: string, options: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Cookie: cookieHeader() };
  if (options.method && options.method !== "GET") {
    const csrfRes = await fetch(`${BASE}/auth/csrf-token`, { headers: { Cookie: cookieHeader() } });
    const setCookie = csrfRes.headers.getSetCookie?.() ?? [];
    cookies = [...cookies, ...setCookie];
    headers["x-csrf-token"] = (await csrfRes.json()).csrfToken;
    headers["Content-Type"] = "application/json";
    headers.Cookie = cookieHeader();
  }
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookies = [...cookies, ...setCookie];
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function report(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const email = `smoke_${Date.now()}@example.test`;

  const reg = await call("/auth/register", {
    method: "POST",
    body: { email, password: "SmokePass123!", fullName: "Smoke Test" },
  });
  report("register + session cookies", reg.status === 201);

  // --- Medicine information -----------------------------------------
  const search = await call("/medicines/search?q=omeprazole");
  report("medicine search", search.status === 200, `${search.body.count} result(s)`);

  if (search.body.medicines?.length) {
    const id = search.body.medicines[0].id;
    const detail = await call(`/medicines/${id}`);
    const info = detail.body.information;
    report(
      "medicine detail + live openFDA label",
      detail.status === 200 && info?.status === "FOUND",
      info?.status === "FOUND"
        ? `${info.monograph.sourceName} (${info.monograph.market}) · uses: ${info.monograph.uses ? "yes" : "no"} · source link: ${info.monograph.sourceUrl ? "yes" : "no"}`
        : `status=${info?.status}`
    );
    report(
      "price honestly unavailable",
      detail.body.price?.status === "UNAVAILABLE",
      detail.body.price?.reason?.slice(0, 60)
    );
  }

  const badSearch = await call("/medicines/search?q=zzzznothingxyz");
  report("empty search is an honest zero", badSearch.status === 200 && badSearch.body.count === 0);

  // --- Prescription -> Scripty ---------------------------------------
  const scriptyStatus = await call("/scripty/status");
  report("scripty status endpoint", scriptyStatus.status === 200, `configured=${scriptyStatus.body.configured}`);

  const meds = await call("/scripty/message", { method: "POST", body: { message: "Show my current medicines" } });
  report("scripty: list medicines", meds.status === 200 && meds.body.tool === "list_my_medications");

  const price = await call("/scripty/message", {
    method: "POST",
    body: { message: "What is the price of Panadol in Pakistan?" },
  });
  report(
    "scripty: price lookup never invents a figure",
    price.status === 200 && price.body.data?.price?.status === "UNAVAILABLE",
    `${price.body.data?.price?.manualCheck?.length ?? 0} manual-check link(s)`
  );

  const delivery = await call("/scripty/message", {
    method: "POST",
    body: { message: "Will I actually get an email notification?" },
  });
  report(
    "scripty: honest reminder-delivery state",
    delivery.body.data?.emailConfigured === false && /not configured/i.test(delivery.body.data?.explanation ?? "")
  );


  // --- Full workflow: upload -> extract -> confirm -> Scripty -> schedule ---
  // A minimal valid JPEG. With AI_PROVIDER=mock this is never read; with
  // AI_PROVIDER=google it is genuinely sent to the model.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);

  const csrfRes = await fetch(`${BASE}/auth/csrf-token`, { headers: { Cookie: cookieHeader() } });
  cookies = [...cookies, ...(csrfRes.headers.getSetCookie?.() ?? [])];
  const csrf = (await csrfRes.json()).csrfToken;

  const form = new FormData();
  form.append("prescriptionImage", new Blob([jpeg], { type: "image/jpeg" }), "rx.jpg");
  const uploadRes = await fetch(`${BASE}/prescriptions`, {
    method: "POST",
    headers: { Cookie: cookieHeader(), "x-csrf-token": csrf },
    body: form,
  });
  const uploaded = await uploadRes.json();
  report("prescription upload", uploadRes.status === 201, uploaded?.prescription?.status);

  const prescriptionId = uploaded?.prescription?.id;
  if (prescriptionId) {
    const extract = await call(`/prescriptions/${prescriptionId}/extract`, { method: "POST" });
    const meds = extract.body?.prescription?.medications ?? [];
    report(
      "extraction produced candidates",
      extract.status === 200 && meds.length > 0,
      `${meds.length} candidate(s) via provider "${extract.body?.prescription?.aiProvider}"`
    );

    const amox = meds.find((m: any) => m.extractedName === "Amoxicillin");
    if (amox) {
      const confirm = await call(`/medications/${amox.id}`, {
        method: "PATCH",
        body: {
          reviewStatus: "CONFIRMED",
          confirmedName: "Amoxicillin",
          confirmedStrength: "500 mg",
          confirmedForm: "capsule",
          confirmedDosageInstructions: "Take one capsule three times daily after meals",
          confirmedFrequency: "3x daily",
          confirmedDurationDays: 7,
        },
      });
      report("medication confirmed by human review", confirm.status === 200);

      // Scripty proposes — and must NOT create anything yet.
      const propose = await call("/scripty/message", {
        method: "POST",
        body: { message: `Remind me to take medication ${amox.id} at 9 PM`, prescriptionId },
      });
      const pending = propose.body?.pendingAction;
      report(
        "scripty proposes a schedule from natural language ('9 PM')",
        propose.status === 200 && !!pending && JSON.stringify(pending.proposal).includes("21:00"),
        pending ? `times: ${(pending.proposal as any).times?.join(", ")}` : "no proposal"
      );

      const schedulesBefore = await call("/schedule/list");
      const countBefore = (schedulesBefore.body?.schedules ?? []).length;

      if (pending) {
        const confirmed = await call("/scripty/confirm", { method: "POST", body: { token: pending.token } });
        const schedulesAfter = await call("/schedule/list");
        const countAfter = (schedulesAfter.body?.schedules ?? []).length;
        report(
          "schedule created only after explicit confirmation",
          confirmed.status === 200 && confirmed.body?.data?.created === true && countAfter === countBefore + 1,
          `${countBefore} -> ${countAfter} schedule(s), ${confirmed.body?.data?.remindersCreated} reminder(s)`
        );
      }
    }
  }

  const unauth = await fetch(`${BASE}/medicines/search?q=test`);
  report("unauthenticated medicine search is 401 (not an empty result)", unauth.status === 401);
}

main().catch((e) => {
  console.error("SMOKE ERROR", e);
  process.exit(1);
});
