import { chromium, expect } from "@playwright/test";
import { hash } from "@node-rs/argon2";
import { collection, client, save } from "../api/db";
import { demoTournament, demoDivision } from "../shared/seed";
const uri = process.env.MONGODB_URI || "";
if (
  !uri.startsWith("mongodb://127.0.0.1:") ||
  process.env.MONGODB_DB !== "test_tournament"
)
  throw Error("Disposable test database required");
const password = crypto.randomUUID(),
  tid = crypto.randomUUID(),
  uid = crypto.randomUUID(),
  email = uid + "@mobile.test";
const division = demoDivision();
for (const match of division.matches) {
  if (match.ref === "referee") match.ref = uid;
}
await collection("users").insertOne({
  uid,
  email,
  hash: await hash(password),
  organizer: false,
});
await client.withSession((s) =>
  s.withTransaction(() =>
    save(
      {
        t: { ...demoTournament, id: tid },
        events: [division],
        staff: { [uid]: "referee" },
        history: {},
      },
      s,
      ["mixed"],
    ),
  ),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
try {
  const ref = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    viewer = await browser.newPage();
  await viewer.goto("http://localhost:5173/#match/" + tid + "/mixed/P5");
  await expect(viewer.getByTestId("score-0")).toHaveText("8");
  await ref.goto("http://localhost:5173/#signin/" + tid + "/mixed");
  await ref.getByLabel("Email").fill(email);
  await ref.getByLabel("Password").fill(password);
  await ref.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    ref.getByRole("heading", { name: "Referee desk" }),
  ).toBeVisible();
  await ref.goto("http://localhost:5173/#match/" + tid + "/mixed/P5");
  await ref.getByRole("button", { name: /^\+1 / }).first().click();
  await expect(viewer.getByTestId("score-0")).toHaveText("9", {
    timeout: 5000,
  });
  console.log(
    "MongoDB-backed phone score synchronized to separate spectator browser",
  );
} finally {
  await browser.close();
  await client.close();
}
