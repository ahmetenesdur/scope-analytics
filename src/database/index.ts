import Database from "better-sqlite3";
import { createTables } from "./schema";

export function initDatabase(dbFile: string): Database.Database {
	const db = new Database(dbFile);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");

	createTables(db);

	console.log("[SUCCESS] Database initialized with event decoding support");
	return db;
}

export function getMeta(db: Database.Database, key: string): string | null {
	const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
	db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}
