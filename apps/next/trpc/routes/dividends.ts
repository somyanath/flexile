import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { byExternalId, db, pagination, paginationSchema } from "@/db";
import { companyInvestors, dividends } from "@/db/schema";
import { companyProcedure, createRouter } from "@/trpc";
import { simpleUser } from "./users";

export const dividendsRouter = createRouter({
  list: companyProcedure
    .input(
      paginationSchema.and(z.object({ investorId: z.string().optional(), dividendRoundId: z.number().optional() })),
    )
    .query(async ({ input, ctx }) => {
      if (
        !ctx.companyAdministrator &&
        !ctx.companyLawyer &&
        !(ctx.companyInvestor && ctx.companyInvestor.externalId === input.investorId)
      )
        throw new TRPCError({ code: "FORBIDDEN" });

      const where = and(
        eq(dividends.companyId, ctx.company.id),
        input.investorId
          ? eq(dividends.companyInvestorId, byExternalId(companyInvestors, input.investorId))
          : undefined,
        input.dividendRoundId ? eq(dividends.dividendRoundId, BigInt(input.dividendRoundId)) : undefined,
      );
      const rows = await db.query.dividends.findMany({
        columns: { numberOfShares: true, totalAmountInCents: true, retainedReason: true, status: true },
        with: {
          dividendRound: { columns: { issuedAt: true } },
          investor: { with: { user: { columns: simpleUser.columns } } },
        },
        where,
        ...pagination(input),
      });
      const total = await db.$count(dividends, where);
      return {
        dividends: rows.map((row) => ({ ...row, investor: { user: simpleUser(row.investor.user) } })),
        total,
      };
    }),
});
