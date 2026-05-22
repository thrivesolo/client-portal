import crypto from "crypto";

export type MockNotionClient = {
  notionPageId: string;
  name: string;
  email: string;
  driveFolderId: string | null;
  priorReturnSummary: string | null;
  tags: string[];
};

const MOCK_NOTION_CLIENTS: MockNotionClient[] = [
  {
    notionPageId: "notion_p_001",
    name: "Marisol Reyes",
    email: "marisol.reyes@example.com",
    driveFolderId: "drive_folder_marisol",
    priorReturnSummary:
      "Filed jointly with spouse for 2023. W-2 wages from two employers, mortgage interest, and one Schedule C for a small Etsy shop ($14k revenue).",
    tags: ["Returning", "Schedule C"],
  },
  {
    notionPageId: "notion_p_002",
    name: "Devon Park",
    email: "devon.park@example.com",
    driveFolderId: "drive_folder_devon",
    priorReturnSummary:
      "First-time client. Single, W-2 only, lives in Brooklyn. Started day-trading in late 2024 — expect 1099-B with substantial activity.",
    tags: ["New", "Investments"],
  },
  {
    notionPageId: "notion_p_003",
    name: "Aisha Whitfield",
    email: "aisha.whitfield@example.com",
    driveFolderId: "drive_folder_aisha",
    priorReturnSummary:
      "Freelance art director (1099-NEC). Home office deduction last year, quarterly estimated taxes, HSA contributions.",
    tags: ["Returning", "1099-NEC", "Home Office"],
  },
  {
    notionPageId: "notion_p_004",
    name: "Jonas Berg",
    email: "jonas.berg@example.com",
    driveFolderId: null,
    priorReturnSummary:
      "Married filing jointly. Software engineer W-2 ($210k) + RSU vesting. Spouse is a teacher. Sold rental property in 2024.",
    tags: ["Returning", "RSUs", "Real Estate"],
  },
  {
    notionPageId: "notion_p_005",
    name: "Priya Krishnamurthy",
    email: "priya.k@example.com",
    driveFolderId: "drive_folder_priya",
    priorReturnSummary: null,
    tags: ["New"],
  },
];

export function getMockNotionClients(): MockNotionClient[] {
  return MOCK_NOTION_CLIENTS;
}

const TAX_TEMPLATE = [
  {
    title: "All W-2 forms",
    category: "Income",
    description: "Wage statements from every employer you worked for during the tax year.",
    whyWeNeedThis:
      "We use these to report wages, federal/state withholding, Social Security, and Medicare taxes.",
  },
  {
    title: "1099-NEC / 1099-MISC",
    category: "Income",
    description: "Income statements from clients who paid you $600+ as a contractor.",
    whyWeNeedThis: "This is self-employment income that flows to your Schedule C.",
  },
  {
    title: "1099-INT / 1099-DIV",
    category: "Income",
    description: "Interest and dividend statements from banks, brokerages, and credit unions.",
    whyWeNeedThis: "Required to report investment income and any qualified dividends.",
  },
  {
    title: "1099-B (brokerage)",
    category: "Investments",
    description:
      "Year-end consolidated tax statement from your brokerage(s) showing capital gains and losses.",
    whyWeNeedThis:
      "Capital gains are taxed at different rates depending on holding period — we need every transaction.",
  },
  {
    title: "Mortgage interest (1098)",
    category: "Deductions",
    description: "Year-end statement from your mortgage servicer showing interest paid.",
    whyWeNeedThis: "Itemized deduction if it exceeds your standard deduction.",
  },
  {
    title: "Property tax statements",
    category: "Deductions",
    description: "Annual property tax bills paid in the tax year.",
    whyWeNeedThis: "Counts toward the SALT deduction (capped at $10k).",
  },
  {
    title: "Charitable contribution receipts",
    category: "Deductions",
    description: "Receipts for any cash or non-cash donations to qualified charities.",
    whyWeNeedThis: "Itemized deduction. Non-cash donations over $500 require extra documentation.",
  },
  {
    title: "HSA contributions (5498-SA)",
    category: "Deductions",
    description: "Statement of all HSA contributions you made outside of payroll.",
    whyWeNeedThis: "Deductible above-the-line, reduces your AGI.",
  },
  {
    title: "Self-employment expense log",
    category: "Business",
    description:
      "Categorized list of business expenses (software, supplies, mileage, home office sq footage).",
    whyWeNeedThis: "Reduces your taxable self-employment income on Schedule C.",
  },
  {
    title: "Quarterly estimated tax payments",
    category: "Payments",
    description: "Confirmations of any 1040-ES payments made throughout the year.",
    whyWeNeedThis: "Credits these against your final tax bill so you don't double-pay.",
  },
];

const SCHEDULE_C_ADDITIONS = [
  {
    title: "Etsy / shop revenue summary",
    category: "Business",
    description: "Year-end revenue and fees report exported from Etsy or your sales platform.",
    whyWeNeedThis: "We need gross sales and platform fees separately for Schedule C.",
  },
];

const RSU_ADDITIONS = [
  {
    title: "RSU vest history (broker statement)",
    category: "Income",
    description: "Year-end summary from your broker showing every RSU vest date, share count, and FMV.",
    whyWeNeedThis: "Avoids double-taxation — RSU income is on your W-2 but the cost basis often is not on the 1099-B.",
  },
  {
    title: "Rental property income & expenses",
    category: "Real Estate",
    description: "Closing statement (HUD-1 / settlement statement) and any rental income / expenses for the year.",
    whyWeNeedThis: "We need this to compute capital gain on the sale and report any rental activity prior to sale.",
  },
];

const HOME_OFFICE_ADDITIONS = [
  {
    title: "Home office details",
    category: "Business",
    description: "Square footage of your office, total home square footage, utility bills, and renters/homeowners insurance.",
    whyWeNeedThis: "Used for the simplified or actual home-office deduction calculation.",
  },
];

export type GeneratedItem = {
  title: string;
  description: string;
  category: string;
  whyWeNeedThis: string;
};

export function generateMockChecklist(input: {
  priorReturnSummary: string | null;
  tags: string[];
}): GeneratedItem[] {
  const items: GeneratedItem[] = [...TAX_TEMPLATE];
  const tagSet = new Set(input.tags);
  const summary = (input.priorReturnSummary ?? "").toLowerCase();

  if (tagSet.has("Schedule C") || summary.includes("etsy") || summary.includes("schedule c")) {
    items.push(...SCHEDULE_C_ADDITIONS);
  }
  if (tagSet.has("RSUs") || tagSet.has("Real Estate") || summary.includes("rsu") || summary.includes("rental")) {
    items.push(...RSU_ADDITIONS);
  }
  if (tagSet.has("Home Office") || summary.includes("home office")) {
    items.push(...HOME_OFFICE_ADDITIONS);
  }
  return items;
}

export type MockDriveUploadResult = {
  driveFileId: string;
  driveFileUrl: string | null;
};

export async function mockDriveUpload(input: {
  folderId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<MockDriveUploadResult> {
  const id = `mock_drive_${crypto.randomBytes(8).toString("hex")}`;
  return {
    driveFileId: id,
    driveFileUrl: `https://drive.google.com/file/d/${id}/view`,
  };
}

export type MockEmailResult = {
  sent: boolean;
  recipient: string;
  mode: "mock";
  previewBody: string;
};

export function mockGmailSend(input: {
  to: string;
  clientName: string;
  magicLinkUrl: string;
}): MockEmailResult {
  const firstName = input.clientName.split(" ")[0] ?? "there";
  const previewBody = [
    `Hi ${firstName},`,
    ``,
    `Your personalized tax-document checklist for this year is ready.`,
    `Click the secure link below to upload everything I need — it goes straight to your folder.`,
    ``,
    `${input.magicLinkUrl}`,
    ``,
    `As always, reach out if you hit any snags.`,
    ``,
    `— J.T.`,
  ].join("\n");
  return { sent: true, recipient: input.to, mode: "mock", previewBody };
}
