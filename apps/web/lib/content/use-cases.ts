import type { ContentCollection, ContentPage } from "./types";

export const useCasesCollection: ContentCollection = {
  id: "use-cases",
  path: "/use-cases",
  label: "Use cases",
  title: "Receipt Scanner Use Cases",
  description:
    "How expense claimants, bookkeepers, freelancers and small business teams use ReceiptOCR to turn receipt photos and PDFs into CSV rows they can check.",
  h1: "Receipt scanner use cases: who uses ReceiptOCR, and how",
  intro:
    "The same extraction runs for everyone: merchant, date, category, line items, tax, tip and total, with a confidence score for the receipt and for each line. What changes is what happens next. Pick the workflow closest to yours.",
  heroArt: "pipeline",
  updated: "2026-11-08",
};

export const useCasePages: ContentPage[] = [
  {
    collection: "use-cases",
    slug: "expense-reports",
    navLabel: "Expense reports",
    icon: "briefcase",
    heroArt: "trip",
    fact: "Groups per trip",
    title: "Receipt Scanner for Expense Reports",
    description:
      "Scan trip and work receipts as you spend, group them per trip, check the flagged ones, then export one CSV to attach to your company's expense claim.",
    h1: "Receipts for expense reports, without retyping them",
    intro:
      "An expense claim usually means a stack of paper receipts, a spreadsheet and an evening of typing amounts. With ReceiptOCR you photograph each receipt when you get it, and by the end of the trip the merchant, date, tax, tip and total of every receipt are already in rows you can check and export.",
    updated: "2026-11-08",
    sections: [
      {
        heading: "From the receipt in your hand to a claim-ready CSV",
        layout: "steps",
        paragraphs: [
          "The work is spread across the trip instead of saved for the end, and the slow part, reading every line and typing it, is done for you.",
        ],
        steps: [
          {
            icon: "camera",
            title: "Photograph it before you lose it",
            body: "Take a photo on your phone, or upload the PDF from your email. ReceiptOCR installs from the browser as a web app.",
          },
          {
            icon: "folder-plus",
            title: "Put the trip in one group",
            body: 'Create a group such as "Client visit, Toronto" and add each receipt. A receipt can also sit in a second group, like a project code.',
          },
          {
            icon: "search-check",
            title: "Check what was flagged",
            body: "The Needs review filter lists receipts below 90% confidence. Compare each with its photo and correct any field; corrections are what gets exported.",
          },
          {
            icon: "file-spreadsheet",
            title: "Export the trip",
            body: "Filter History by the group and export one CSV: date, merchant, category, currency, subtotal, tax, tip, total and confidence per receipt.",
          },
        ],
      },
      {
        heading: "Why tip and tax are separate columns",
        paragraphs: [
          "Many expense policies treat tips, tax and the meal itself differently, so ReceiptOCR reads the printed tax, tip and total as separate fields, and a service charge is never counted as a tip.",
          "When a restaurant receipt has line items, each one is listed with its quantity and price, which helps when a policy excludes some items, such as alcohol, and you need to show what the rest cost.",
        ],
      },
      {
        heading: "What it does for expense reports, and what it leaves to your company",
        layout: "does-doesnt",
        paragraphs: [
          "ReceiptOCR is where receipts are read and checked, not an expense management system. The export is a plain CSV that any spreadsheet app opens, so it fits whatever process your company already has.",
        ],
        does: [
          "Scans receipts on your phone, from a photo or a PDF",
          "Keeps each trip's receipts together in a group",
          "Flags receipts below 90% confidence for review",
          "Exports the trip as one CSV, with each original photo or PDF on its receipt page",
        ],
        doesnt: [
          "Approval steps",
          "Reimbursements",
          "Per-diem or mileage rules",
          "Currency conversion",
          "A connection to your company's expense software",
        ],
      },
    ],
    example: {
      heading: "A dinner receipt from a work trip",
      caption:
        "How the receipt page shows a restaurant receipt from a work trip, and the CSV you would export for the trip's group: the dinner, the hotel and a taxi.",
      fileName: "dinner_oct14.jpg",
      extraction: {
        merchant: "Harbour Grill",
        receiptDate: "2026-10-14",
        category: "Meals",
        currency: "CAD",
        subtotal: 76,
        tax: 9.88,
        tip: 14,
        total: 99.88,
        confidence: 0.96,
        items: [
          { name: "Grilled salmon", quantity: 1, unitPrice: 28, totalPrice: 28, confidence: 0.97 },
          { name: "Steak frites", quantity: 1, unitPrice: 32, totalPrice: 32, confidence: 0.96 },
          { name: "Sparkling water", quantity: 2, unitPrice: 4.5, totalPrice: 9, confidence: 0.94 },
          { name: "Espresso", quantity: 2, unitPrice: 3.5, totalPrice: 7, confidence: 0.92 },
        ],
      },
      exportView: "history-csv",
      groups: ["Client visit, Toronto"],
      historyRows: [
        {
          merchant: "Harbourview Hotel",
          receiptDate: "2026-10-15",
          category: "Travel",
          currency: "CAD",
          subtotal: 368,
          tax: 47.84,
          tip: null,
          total: 415.84,
          confidence: 0.94,
          itemCount: 2,
          fileName: "hotel_folio.pdf",
        },
        {
          merchant: "City Cab",
          receiptDate: "2026-10-15",
          category: "Travel",
          currency: "CAD",
          subtotal: 20.4,
          tax: 2.65,
          tip: 3,
          total: 26.05,
          confidence: 0.91,
          itemCount: 1,
          fileName: "taxi_airport.jpg",
        },
      ],
    },
    faqs: [
      {
        q: "Can I keep receipts from different trips apart?",
        a: "Yes. Make a group for each trip or project and add receipts to it. In History you can filter by one or more groups and export only those receipts as one CSV, and the CSV has a groups column so the rows stay labelled.",
      },
      {
        q: "My receipts are in a different currency from my salary. What happens?",
        a: "Each receipt keeps the currency printed on it, as a three-letter code such as EUR or CAD in its own column. ReceiptOCR does not convert amounts, and the spending summary never adds different currencies together. Your company's claim process applies its own exchange rate.",
      },
      {
        q: "Can I submit the expense report from ReceiptOCR?",
        a: "No. There is no approval or reimbursement flow. You export a CSV, and you can open each receipt's original photo or PDF from its page, to attach to the form or tool your company uses.",
      },
      {
        q: "What if a receipt is faded or the photo is blurry?",
        a: "A receipt that could not be read says so and offers a retry, and a few failed reads do not count towards your scan allowance. A receipt that was read with low confidence shows up under Needs review, and its page marks the lines that were hard to read.",
      },
    ],
    related: ["/use-cases/small-businesses", "/use-cases/freelancers-taxes"],
    cta: {
      heading: "Start your next trip with ReceiptOCR",
      body: "Free to start, no card required. Scan the first receipt on your phone in under a minute.",
    },
  },
  {
    collection: "use-cases",
    slug: "bookkeeping",
    navLabel: "Bookkeepers & accountants",
    icon: "calculator",
    heroArt: "client",
    fact: "VAT or sales tax",
    title: "Receipt OCR for Bookkeepers and Accountants",
    description:
      "Client receipts become CSV rows with subtotal, VAT or sales tax, total, category and a confidence score, plus a Needs review list of what to check first.",
    h1: "Receipt data entry for bookkeepers, with the checking built in",
    intro:
      "Clients send receipts as phone photos, scanned PDFs and crumpled paper. Typing them in is slow, and an OCR tool that reads them without saying how sure it is only moves the work to checking everything. ReceiptOCR gives every receipt and every line a confidence score, so you check the receipts that need it and sample the rest.",
    updated: "2026-11-08",
    sections: [
      {
        heading: "Two ways to work with client receipts",
        layout: "tiles",
        paragraphs: [
          "Receipts belong to a workspace, and everyone in a workspace sees the same history.",
        ],
        tiles: [
          {
            icon: "building",
            title: "Client's workspace invites you",
            body: "The client uploads from their phone; you review and export, and switch between clients from the menu.",
            diagram: ["Client", "Workspace", "You"],
          },
          {
            icon: "tags",
            title: "Your workspace, one group per client",
            body: "You upload what clients send and filter History by the client's group when you export.",
            diagram: ["You", "Group", "CSV"],
          },
        ],
      },
      {
        heading: "From printed lines to CSV columns",
        layout: "fieldmap",
        paragraphs: [
          "Each receipt gets a merchant (the trading name, not the legal company name), a date, one of twelve spending categories, a currency, and the subtotal, tax, tip and total as printed. Tax is every printed VAT, GST or sales tax amount, whether added on top or already included in the prices.",
        ],
        fieldmap: {
          lines: [
            { text: "BÜROWELT" },
            { text: "21.10.2026  14:32" },
            { text: "5x Kopierpapier A4", amount: "24,95" },
            { text: "1x Toner TN-2420", amount: "64,90" },
            { text: "10x Ordner breit", amount: "14,90" },
            { text: "Netto", amount: "88,03" },
            { text: "MwSt 19%", amount: "16,72" },
            { text: "Summe EUR", amount: "104,75" },
            { text: "Vielen Dank" },
          ],
          fields: [
            { name: "merchant", value: "Bürowelt", from: 0 },
            { name: "receipt_date", value: "2026-10-21", from: 1 },
            { name: "category", value: "Office", note: "from the items" },
            { name: "currency", value: "EUR", from: 7 },
            { name: "subtotal", value: "88.03", from: 5 },
            { name: "tax", value: "16.72", from: 6 },
            { name: "tip", value: "", note: "none printed" },
            { name: "total", value: "104.75", from: 7 },
            { name: "confidence", value: "0.93", note: "how legible" },
          ],
        },
      },
      {
        heading: "Checking before it reaches the books",
        paragraphs: [
          'The History list has a Needs review filter for receipts whose overall confidence is below 90%. On the receipt page, lines that were hard to read are marked, and a note says when the amounts disagree, for example "The amounts add up to €104.20, but the total says €104.75". You correct the header fields (merchant, date, category, currency, subtotal, tax, tip and total) and the corrected values are what gets exported. Line items cannot be edited yet.',
          "The confidence column is in the export too, so you can sort by it in a spreadsheet and look at the lowest first.",
        ],
      },
      {
        heading: "What you get, and what stays with you",
        layout: "does-doesnt",
        paragraphs: [
          "ReceiptOCR prepares clean, checked data for your own import or review. Booking it is still your work.",
        ],
        does: [
          "Reads VAT, GST or sales tax as printed, added on top or included",
          "Exports any filtered set (search, status, category, dates, groups) as one CSV",
          "Copies the full extraction of a receipt as JSON",
          "Escapes cells starting with =, +, - or @ so a merchant name cannot run as a formula",
        ],
        doesnt: [
          "Connect to accounting software",
          "Write spreadsheet files other than CSV",
          "Decide how a receipt should be booked",
          "Decide whether an expense is deductible",
        ],
      },
    ],
    exampleAfter: 2,
    example: {
      heading: "An office supplies receipt with VAT included",
      caption:
        "The receipt above as the receipt page shows it: the net subtotal and the VAT are printed, so subtotal plus tax equals the total. Below, the client's receipts for the month as a History CSV.",
      fileName: "client_buerowelt.pdf",
      extraction: {
        merchant: "Bürowelt",
        receiptDate: "2026-10-21",
        category: "Office",
        currency: "EUR",
        subtotal: 88.03,
        tax: 16.72,
        tip: null,
        total: 104.75,
        confidence: 0.93,
        items: [
          {
            name: "Kopierpapier A4",
            quantity: 5,
            unitPrice: 4.99,
            totalPrice: 24.95,
            confidence: 0.95,
          },
          {
            name: "Toner TN-2420",
            quantity: 1,
            unitPrice: 64.9,
            totalPrice: 64.9,
            confidence: 0.93,
          },
          {
            name: "Ordner breit",
            quantity: 10,
            unitPrice: 1.49,
            totalPrice: 14.9,
            confidence: 0.91,
          },
        ],
      },
      exportView: "history-csv",
      groups: ["Client: Novak Design"],
      historyRows: [
        {
          merchant: "Shell",
          receiptDate: "2026-10-23",
          category: "Fuel",
          currency: "EUR",
          subtotal: 58.82,
          tax: 11.18,
          tip: null,
          total: 70,
          confidence: 0.97,
          itemCount: 1,
          fileName: "fuel_2310.jpg",
        },
        {
          merchant: "Hosting Nord",
          receiptDate: "2026-10-01",
          category: "Software",
          currency: "EUR",
          subtotal: 20,
          tax: 3.8,
          tip: null,
          total: 23.8,
          confidence: 0.98,
          itemCount: 1,
          fileName: "invoice_oct.pdf",
        },
      ],
    },
    faqs: [
      {
        q: "Can each client have their own space?",
        a: "Yes. A client can create a workspace and invite you as a member or manager, and you switch between workspaces from the menu. Or you keep one workspace and use a group per client. Each Free account can own one workspace; Pro workspaces are upgraded one at a time.",
      },
      {
        q: "How is tax read when VAT is already included in the prices?",
        a: "Tax is the VAT, GST or sales tax amount printed on the receipt, whether it was added on top or included. If the net subtotal is printed, it is the subtotal; if not, the subtotal is left empty rather than calculated.",
      },
      {
        q: "Which categories are used?",
        a: "Twelve fixed spending categories: Meals, Groceries, Travel, Fuel, Office, Software, Equipment, Supplies, Utilities, Services, Fees and Other. They describe what was bought, not a chart of accounts, so you map them to your client's accounts yourself.",
      },
      {
        q: "Does it connect to my accounting software?",
        a: "No. The output is CSV (per receipt with line items, or one row per receipt from History) and JSON, which you can import or paste wherever your process needs it.",
      },
      {
        q: "How do I know which receipts to check?",
        a: "Use the Needs review filter in History, which lists receipts with overall confidence below 90%. Each receipt and each line has its own score, the confidence column is in the CSV, and each receipt's page points out lines that were hard to read and totals that do not add up.",
      },
    ],
    related: ["/use-cases/small-businesses", "/use-cases/freelancers-taxes"],
    cta: {
      heading: "Try it on one client's receipts",
      body: "Free to start, no card required. Upload a month of receipts and see how many need a second look.",
    },
  },
  {
    collection: "use-cases",
    slug: "freelancers-taxes",
    navLabel: "Freelancers & taxes",
    icon: "receipt",
    heroArt: "tax-year",
    fact: "Any tax year",
    title: "Receipt Tracker for Freelancers' Tax Records",
    description:
      "Freelancers: scan business receipts through the year, filter by your own tax year's dates and export one CSV of expenses for your tax return or accountant.",
    h1: "Keep a freelancer's receipts ready for the tax return",
    intro:
      "When you work for yourself, the receipts for your laptop, software and travel are part of your tax records, and the deadline to file comes once a year whether they are in order or not. ReceiptOCR lets you scan each receipt when you pay, so at the end of your tax year the list of expenses is already there, with the original files next to it.",
    updated: "2026-11-08",
    sections: [
      {
        heading: "A little every week instead of all at once",
        layout: "steps",
        paragraphs: [
          "Most of the work in freelance bookkeeping is remembering. A habit of scanning receipts when they arrive replaces a long search through email, bags and drawers later.",
        ],
        steps: [
          {
            icon: "camera",
            title: "Scan when you pay",
            body: "Photograph a paper receipt or upload the PDF that came by email. HEIC, JPEG, PNG, WebP and PDF all work.",
          },
          {
            icon: "tags",
            title: "Let it sort by category",
            body: "Each receipt gets one of twelve categories, such as Software or Travel. Change it if it is wrong, or add a group per client.",
          },
          {
            icon: "calendar-range",
            title: "Filter by your tax year",
            body: "Tax years start on different dates in different countries, so choose the first and last day of yours in History.",
          },
          {
            icon: "file-spreadsheet",
            title: "Export and hand over",
            body: "Export the filtered list as one CSV and give it to your accountant, or use it to fill in your expenses.",
          },
        ],
      },
      {
        heading: "See where the money went",
        paragraphs: [
          "The home screen of the app shows spending for the month and over time, with the tax as printed on the receipts and the average per receipt. If you are paid in one currency and spend in another, each currency has its own totals; ReceiptOCR never adds them together.",
        ],
      },
      {
        heading: "What it is, and what it is not",
        layout: "does-doesnt",
        paragraphs: [
          "ReceiptOCR is a record of what you spent, read from your receipts. Rules on which records to keep, and for how long, differ by country, so check them with your tax office or accountant, including whether you must keep the paper originals.",
        ],
        does: [
          "Keeps the original photo or PDF next to the extracted data",
          "Totals spending per currency, without mixing currencies",
          "Exports any date range as one CSV",
          "Scores every receipt and every line for confidence",
        ],
        doesnt: [
          "Give tax advice",
          "Decide which expenses are deductible",
          "Calculate or file your taxes",
          "Use your country's tax categories",
        ],
      },
    ],
    example: {
      heading: "A camera equipment receipt",
      caption:
        "A receipt for work equipment with VAT included, and the JSON that Copy JSON puts on your clipboard, ready for your own spreadsheet or script.",
      fileName: "tripod_receipt.heic",
      extraction: {
        merchant: "Lens & Light",
        receiptDate: "2026-09-03",
        category: "Equipment",
        currency: "GBP",
        subtotal: 115,
        tax: 23,
        tip: null,
        total: 138,
        confidence: 0.95,
        items: [
          {
            name: "Carbon tripod T-200",
            quantity: 1,
            unitPrice: 89,
            totalPrice: 89,
            confidence: 0.96,
          },
          {
            name: "SD card 128GB",
            quantity: 2,
            unitPrice: 24.5,
            totalPrice: 49,
            confidence: 0.94,
          },
        ],
      },
      exportView: "json",
    },
    faqs: [
      {
        q: "My tax year does not start in January. Can I still export one year?",
        a: "Yes. History filters by receipt date with any start and end date, so you pick the dates of your own tax year and export only those receipts as one CSV.",
      },
      {
        q: "Will ReceiptOCR tell me what I can deduct?",
        a: "No. It reads what is printed on your receipts and gives each a spending category. Which expenses count for tax depends on your country and your work; ask your tax office or accountant.",
      },
      {
        q: "Is the original receipt kept?",
        a: "Yes. The photo or PDF is kept in private storage next to the extracted data, and you can open it from the receipt's page. Check your country's rules on whether you also need to keep the paper.",
      },
      {
        q: "Is it free for one person?",
        a: "The Free plan needs no card and includes a daily and monthly allowance of scans. If you scan more than that, Pro raises the monthly allowance for your workspace; see the pricing page for current limits.",
      },
    ],
    related: ["/use-cases/expense-reports", "/use-cases/bookkeeping"],
    cta: {
      heading: "Scan this week's receipts",
      body: "Free to start, no card required. Your history and exports are there whenever you need them.",
    },
  },
  {
    collection: "use-cases",
    slug: "small-businesses",
    navLabel: "Small businesses",
    icon: "users",
    heroArt: "team",
    fact: "3 roles",
    title: "Receipt Scanner for Small Business Teams",
    description:
      "One shared receipt history for your business: everyone scans from their phone, a manager checks flagged receipts, and the owner exports CSV for the books.",
    h1: "One receipt history for the whole team",
    intro:
      "In a small business, receipts are spread across people: the van driver's fuel, the shop manager's supplies, the owner's software subscriptions. ReceiptOCR gives the business one shared workspace where everyone scans their own receipts, and the person who keeps the books sees all of them, already read and ready to check.",
    updated: "2026-11-08",
    sections: [
      {
        heading: "Everyone scans, one person checks",
        layout: "tiles",
        paragraphs: [
          "The workspace is the business. Each person signs in with their own account, so you can see who is in the workspace and remove someone who leaves without sharing a password.",
        ],
        tiles: [
          {
            icon: "user",
            title: "Member",
            body: "Uploads receipts and sees everything in the workspace.",
            chip: "Upload",
          },
          {
            icon: "user-cog",
            title: "Manager",
            body: "Everything a member can do, plus invites and removes people.",
            chip: "Invite and remove",
          },
          {
            icon: "crown",
            title: "Owner",
            body: "Full control of the workspace and everyone in it.",
            chip: "Everything",
          },
        ],
      },
      {
        heading: "Built for phones on the job",
        paragraphs: [
          "Staff install ReceiptOCR from their browser as a web app, with no app store download, and it opens from the home screen. On Android they can also share a photo from another app straight to ReceiptOCR. Large photos are made smaller before upload, which also removes the camera's location data.",
          'Groups label receipts by job, site or project, such as "Job: Elm Street kitchen", so the cost of one job can be exported on its own.',
        ],
      },
      {
        heading: "What the person doing the books gets",
        paragraphs: [
          "Every receipt arrives with merchant, date, category, line items, tax and total, and a confidence score for the receipt and each line. The Needs review filter collects receipts whose overall confidence is below 90%; each receipt's page also marks lines that were hard to read and amounts that do not add up to the total. Corrections to the header fields are what gets exported.",
          "The app's home screen shows the workspace's spending this month and over time, per currency. When it is time to update the books, History exports any filtered set (a month, a category, a job) as one CSV.",
        ],
      },
      {
        heading: "Plans, limits and what it leaves out",
        layout: "does-doesnt",
        paragraphs: [
          "Free scans are counted per person. When the business needs more, Pro is bought for one workspace and its larger monthly allowance is shared by everyone in it.",
        ],
        does: [
          "One shared history for everyone in the workspace",
          "Groups per job, site or project",
          "Spending per month and per currency on the home screen",
          "One CSV for any filtered set of receipts",
        ],
        doesnt: [
          "Issue company cards",
          "Run approvals",
          "Connect to accounting software",
          "Hide receipts from others in the same workspace",
        ],
      },
    ],
    example: {
      heading: "A hardware store receipt with one line to check",
      caption:
        "A supplies receipt where one line was hard to read: it is marked so the person checking compares it with the photo. Below, the job's receipts as a History CSV.",
      fileName: "IMG_4471.jpg",
      extraction: {
        merchant: "Northside Hardware",
        receiptDate: "2026-10-28",
        category: "Supplies",
        currency: "USD",
        subtotal: 87.6,
        tax: 7.23,
        tip: null,
        total: 94.83,
        confidence: 0.88,
        items: [
          {
            name: "DECK SCREWS 5LB",
            quantity: 1,
            unitPrice: 34.99,
            totalPrice: 34.99,
            confidence: 0.95,
          },
          {
            name: "ROLLER 9IN",
            quantity: 3,
            unitPrice: 6.49,
            totalPrice: 19.47,
            confidence: 0.93,
          },
          {
            name: "DROP CLOTH 9X12",
            quantity: 2,
            unitPrice: 8.99,
            totalPrice: 17.98,
            confidence: 0.9,
          },
          {
            name: "MSK TAPE 1.88",
            quantity: 4,
            unitPrice: 3.79,
            totalPrice: 15.16,
            confidence: 0.68,
          },
        ],
      },
      exportView: "history-csv",
      groups: ["Job: Elm Street kitchen"],
      historyRows: [
        {
          merchant: "Riverside Lumber",
          receiptDate: "2026-10-27",
          category: "Supplies",
          currency: "USD",
          subtotal: 412.5,
          tax: 34.03,
          tip: null,
          total: 446.53,
          confidence: 0.92,
          itemCount: 6,
          fileName: "lumber.pdf",
        },
        {
          merchant: "QuickFuel",
          receiptDate: "2026-10-28",
          category: "Fuel",
          currency: "USD",
          subtotal: null,
          tax: null,
          tip: null,
          total: 61.2,
          confidence: 0.97,
          itemCount: 1,
          fileName: "fuel_van2.jpg",
        },
      ],
    },
    faqs: [
      {
        q: "Can staff see each other's receipts?",
        a: "Yes. Everyone in a workspace sees every receipt in it, which is what lets one person check and export them all. If some receipts must stay private, keep them in a separate workspace.",
      },
      {
        q: "Do my staff need to install an app?",
        a: "No download from an app store is needed. ReceiptOCR works in the browser and can be installed from it as a web app on iPhone, Android and desktop.",
      },
      {
        q: "How does Pro work for a team?",
        a: "Pro covers one workspace, and its monthly scan allowance is shared by everyone in it. Other workspaces stay on Free until each is upgraded. See the pricing page for the current price and limits.",
      },
      {
        q: "Can I see the cost of one job or site?",
        a: "Yes. Put the job's receipts in a group, filter History by that group and export them as one CSV. The CSV includes the groups column, so the label stays on every row.",
      },
    ],
    related: ["/use-cases/bookkeeping", "/use-cases/expense-reports"],
    cta: {
      heading: "Set up your team's workspace",
      body: "Free to start, no card required. Invite your team when the first receipts are in.",
    },
  },
];
