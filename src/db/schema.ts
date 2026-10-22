// Shared by the app and the worker. Money is integer cents; timestamps are UTC.
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'timestamp' });
const bool = (name: string) => integer(name, { mode: 'boolean' });
const id = () => integer('id').primaryKey({ autoIncrement: true });

export const tenders = sqliteTable('tenders', {
  ocid: text('ocid').primaryKey(),
  etenderId: text('etender_id'),
  reference: text('reference'),
  title: text('title'),
  // Short name used in sentences, e.g. the banner ("SALGA participation platform").
  shortTitle: text('short_title'),
  description: text('description'),
  buyerId: text('buyer_id'),
  entity: text('entity'),
  province: text('province'),
  provinceSource: text('province_source', { enum: ['lookup', 'read', 'confirmed'] }),
  workType: text('work_type', { enum: ['website', 'system', 'design'] }),
  tenderType: text('tender_type', { enum: ['quotation', 'open_bid'] }),
  relevant: bool('relevant'),
  relevanceReason: text('relevance_reason'),
  closesAt: ts('closes_at'),
  publishedAt: ts('published_at'),
  briefingAt: ts('briefing_at'),
  briefingWhere: text('briefing_where'),
  briefingCompulsory: bool('briefing_compulsory'),
  submitMethod: text('submit_method'),
  submitWhere: text('submit_where'),
  submitCopies: text('submit_copies'),
  funcThreshold: integer('func_threshold'),
  preferenceSystem: text('preference_system', { enum: ['80/20', '90/10'] }),
  firstSeenAt: ts('first_seen_at'),
  openedAt: ts('opened_at'),
  cancelled: bool('cancelled').notNull().default(false),
  rawJson: text('raw_json'),
  updatedAt: ts('updated_at'),
});

export const buyers = sqliteTable('buyers', {
  buyerId: text('buyer_id').primaryKey(),
  name: text('name'),
  province: text('province'),
  confirmed: bool('confirmed').notNull().default(false),
});

export const tenderDocuments = sqliteTable('tender_documents', {
  id: id(),
  ocid: text('ocid').notNull().references(() => tenders.ocid),
  sourceId: text('source_id'),
  title: text('title'),
  format: text('format'),
  url: text('url'),
  localPath: text('local_path'),
  pdfPath: text('pdf_path'),
  pages: integer('pages'),
  belongsCheck: text('belongs_check', { enum: ['ok', 'mismatch', 'unknown'] }).notNull().default('unknown'),
  downloadedAt: ts('downloaded_at'),
});

export const tenderChanges = sqliteTable('tender_changes', {
  id: id(),
  ocid: text('ocid').notNull().references(() => tenders.ocid),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  // What announced it, e.g. "Addendum 1".
  source: text('source'),
  detectedAt: ts('detected_at').notNull(),
  seenAt: ts('seen_at'),
});

export const funcCriteria = sqliteTable('func_criteria', {
  id: id(),
  ocid: text('ocid').notNull().references(() => tenders.ocid),
  name: text('name').notNull(),
  points: integer('points'),
  // A vault kind, or "upload" for the user's own document.
  evidence: text('evidence'),
  sourcePage: integer('source_page'),
});

export const specificGoals = sqliteTable('specific_goals', {
  id: id(),
  ocid: text('ocid').notNull().references(() => tenders.ocid),
  name: text('name').notNull(),
  points: integer('points'),
  profileField: text('profile_field'),
  sourcePage: integer('source_page'),
});

export const bids = sqliteTable('bids', {
  id: id(),
  ocid: text('ocid').notNull().unique().references(() => tenders.ocid),
  // "Awaiting result" is not stored: it is a submitted bid whose closing date has passed.
  stage: text('stage', { enum: ['preparing', 'submitted', 'won', 'lost', 'cancelled'] }).notNull(),
  startedAt: ts('started_at').notNull(),
  submittedAt: ts('submitted_at'),
  submitMethod: text('submit_method'),
  finalPriceCents: integer('final_price_cents'),
  result: text('result', { enum: ['won', 'lost', 'cancelled'] }),
  winnerName: text('winner_name'),
  winningPriceCents: integer('winning_price_cents'),
  resultRecordedAt: ts('result_recorded_at'),
});

export const bidDocuments = sqliteTable('bid_documents', {
  id: id(),
  bidId: integer('bid_id').notNull().references(() => bids.id),
  group: text('group', { enum: ['compliance', 'functionality'] }).notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['form', 'vault', 'upload'] }).notNull(),
  formType: text('form_type', { enum: ['generic', 'disclosure', 'sbd61', 'pricing'] }),
  vaultKind: text('vault_kind'),
  done: bool('done').notNull().default(false),
  formDataJson: text('form_data_json'),
  filePath: text('file_path'),
  pages: integer('pages'),
  needsSignature: bool('needs_signature').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  sourcePage: integer('source_page'),
});

export const pricingLines = sqliteTable('pricing_lines', {
  id: id(),
  bidId: integer('bid_id').notNull().references(() => bids.id),
  label: text('label').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitPriceCents: integer('unit_price_cents'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const vaultDocuments = sqliteTable('vault_documents', {
  id: id(),
  kind: text('kind').notNull().unique(),
  name: text('name').notNull(),
  // Null until the user uploads the file.
  filePath: text('file_path'),
  issuedAt: ts('issued_at'),
  expiresAt: ts('expires_at'),
  notes: text('notes'),
});

export const companyProfile = sqliteTable('company_profile', {
  id: integer('id').primaryKey(),
  name: text('name'),
  initials: text('initials'),
  registrationNumber: text('registration_number'),
  csdNumber: text('csd_number'),
  taxPin: text('tax_pin'),
  vatRegistered: bool('vat_registered').notNull().default(false),
  vatNumber: text('vat_number'),
  address: text('address'),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  province: text('province'),
  blackOwnershipPct: integer('black_ownership_pct'),
  womenOwnershipPct: integer('women_ownership_pct'),
  youthOwned: bool('youth_owned').notNull().default(false),
});

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  alertEmail: text('alert_email'),
  alertMode: text('alert_mode', { enum: ['instant', 'digest'] }).notNull().default('instant'),
  alertOnChanges: bool('alert_on_changes').notNull().default(true),
  savedFiltersJson: text('saved_filters_json'),
});

export const bidRegisters = sqliteTable('bid_registers', {
  id: id(),
  entity: text('entity'),
  job: text('job'),
  workType: text('work_type', { enum: ['website', 'system', 'design'] }),
  year: integer('year'),
  sourceFile: text('source_file'),
  // Set when the register came from a result recorded in My bids.
  ocid: text('ocid').references(() => tenders.ocid),
  createdAt: ts('created_at').notNull(),
});

export const registerBids = sqliteTable('register_bids', {
  id: id(),
  registerId: integer('register_id').notNull().references(() => bidRegisters.id),
  bidder: text('bidder'),
  priceCents: integer('price_cents'),
  won: bool('won').notNull().default(false),
});

export const fetchRuns = sqliteTable('fetch_runs', {
  id: id(),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
  windowFrom: text('window_from'),
  windowTo: text('window_to'),
  fetched: integer('fetched').notNull().default(0),
  added: integer('added').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  errorsJson: text('errors_json'),
});

export const alertsSent = sqliteTable(
  'alerts_sent',
  {
    id: id(),
    kind: text('kind').notNull(),
    ref: text('ref').notNull(),
    sentAt: ts('sent_at').notNull(),
  },
  (t) => [uniqueIndex('alerts_sent_kind_ref').on(t.kind, t.ref)],
);

export const aiCalls = sqliteTable('ai_calls', {
  id: id(),
  purpose: text('purpose').notNull(),
  model: text('model').notNull(),
  ocid: text('ocid'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  ok: bool('ok').notNull(),
  error: text('error'),
  createdAt: ts('created_at').notNull(),
});
