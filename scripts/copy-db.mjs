// Copy every table from the old (Oregon) DB to the new (Frankfurt) DB.
// Uses the backend's own Prisma client twice with datasource overrides.
// Schema has no FK constraints, so table order is irrelevant.
import { PrismaClient, Prisma } from '@prisma/client';

const [oldUrl, newUrl] = [process.env.OLD_DB, process.env.NEW_DB];
if (!oldUrl || !newUrl) { console.error('set OLD_DB and NEW_DB'); process.exit(1); }

const src = new PrismaClient({ datasources: { db: { url: oldUrl } } });
const dst = new PrismaClient({ datasources: { db: { url: newUrl } } });

const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
let total = 0;
for (const name of models) {
  const key = name[0].toLowerCase() + name.slice(1);
  const rows = await src[key].findMany();
  if (!rows.length) { console.log(name.padEnd(18), 0); continue; }
  const res = await dst[key].createMany({ data: rows, skipDuplicates: true });
  console.log(name.padEnd(18), rows.length, '->', res.count, 'inserted');
  total += res.count;
}
console.log('TOTAL rows copied:', total);
await src.$disconnect(); await dst.$disconnect();
