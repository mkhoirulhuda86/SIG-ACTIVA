import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const r = await p.fluktuasiAkunPeriode.findMany({
  distinct: ['accountCode'],
  select: { accountCode: true },
  orderBy: { accountCode: 'asc' },
});
console.log(r.map(x => x.accountCode));
await p.$disconnect();
