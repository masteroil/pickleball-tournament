import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collection, initialize, client } from "./db";
try {
  const email = z.email().parse(process.env.ACCOUNT_EMAIL).toLowerCase();
  const password = z
    .string()
    .min(12)
    .max(256)
    .parse(process.env.ACCOUNT_PASSWORD);
  await initialize();
  const uid = randomUUID();
  await collection("users").insertOne({
    uid,
    email,
    hash: await hash(password),
    organizer: process.argv.includes("--organizer"),
  });
  console.log("Created user ID", uid);
} finally {
  await client.close();
}
