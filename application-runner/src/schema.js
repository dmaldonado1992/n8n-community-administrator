import { z } from 'zod';

const candidateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email(),
  phone: z.string().min(7).optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  linkedinUrl: z.url().optional(),
  websiteUrl: z.url().optional(),
});

export const applicationSchema = z.object({
  applicationId: z.string().min(1).max(128),
  notionPageId: z.string().min(1),
  jobUrl: z.url(),
  candidate: candidateSchema,
  resumeText: z.string().min(20),
  coverLetter: z.string().optional(),
  approvalSource: z.literal('notion_apply_button'),
  approvedAt: z.iso.datetime(),
  dryRun: z.boolean().default(false),
});

export const resumeSchema = z.object({
  applicationId: z.string().min(1).max(128),
  sessionId: z.string().min(1),
  approvalSource: z.literal('notion_apply_button'),
  approvedAt: z.iso.datetime(),
});

