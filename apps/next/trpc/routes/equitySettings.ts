import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { PayRateType } from "@/db/enums";
import { companyContractors, equityAllocations } from "@/db/schema";
import { MAX_EQUITY_PERCENTAGE } from "@/models";
import { companyProcedure, createRouter } from "@/trpc";
import { getUniqueUnvestedEquityGrantForYear } from "./equityGrants";

export const equitySettingsRouter = createRouter({
  get: companyProcedure.query(async ({ ctx }) => {
    if (!ctx.companyContractor) throw new TRPCError({ code: "FORBIDDEN" });
    assertPermissions(ctx.companyContractor);

    return { allocation: await getEquityAllocation(ctx.companyContractor.id) };
  }),

  update: companyProcedure
    .input(z.object({ equityPercentage: z.number().min(0).max(MAX_EQUITY_PERCENTAGE) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.companyContractor) throw new TRPCError({ code: "FORBIDDEN" });
      assertPermissions(ctx.companyContractor);
      if (ctx.companyContractor.onTrial) throw new TRPCError({ code: "FORBIDDEN" });

      const equityAllocation = await getEquityAllocation(ctx.companyContractor.id);
      if (equityAllocation?.locked) throw new TRPCError({ code: "FORBIDDEN" });

      const unvestedEquityGrant = await getUniqueUnvestedEquityGrantForYear(
        ctx.companyContractor,
        new Date().getFullYear(),
      );
      if (!unvestedEquityGrant) throw new TRPCError({ code: "FORBIDDEN" });

      await db
        .insert(equityAllocations)
        .values({
          companyContractorId: ctx.companyContractor.id,
          year: new Date().getFullYear(),
          equityPercentage: input.equityPercentage,
        })
        .onConflictDoUpdate({
          target: [equityAllocations.companyContractorId, equityAllocations.year],
          set: { equityPercentage: input.equityPercentage },
        });
    }),
});

const assertPermissions = (contractor: typeof companyContractors.$inferSelect) => {
  if (contractor.payRateType === PayRateType.Salary) throw new TRPCError({ code: "FORBIDDEN" });
  if (contractor.endedAt && new Date() > contractor.endedAt) throw new TRPCError({ code: "FORBIDDEN" });
};

const getEquityAllocation = async (contractorId: bigint) =>
  await db.query.equityAllocations.findFirst({
    columns: { equityPercentage: true, locked: true },
    where: and(
      eq(equityAllocations.companyContractorId, contractorId),
      eq(equityAllocations.year, new Date().getFullYear()),
    ),
  });
