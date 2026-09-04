import type {
  RuleCategory,
  RuleEnforcement,
  RuleValueType,
} from "@/lib/generated/prisma/enums";

/**
 * THE RULES THE ASSOCIATION AGREED TO, WRITTEN DOWN ONCE.
 *
 * Every number this platform enforces against a member's money lives in this
 * file, paired with the sentence that explains it in the two languages members
 * read. Nothing else in the codebase is allowed to hard-code a contribution
 * amount, a fine rate, a borrowing limit or an interest split — services ask
 * `getPolicy()` and get whatever the association has resolved these to be.
 *
 * WHY A CATALOGUE AND NOT JUST DATABASE ROWS. The rows are the truth; this is
 * the shape they must take. Holding the catalogue in code means:
 *
 *   • an association that has never opened the rules screen still has a
 *     complete, sane, documented policy from day one;
 *   • a rule the code depends on cannot be deleted, only retuned, so no
 *     service can ever find itself with no policy to apply;
 *   • adding a rule is a code change reviewed like any other, while changing
 *     what a rule *says* is a committee decision made in the UI.
 *
 * WHY EVERY RULE CARRIES ITS OWN PROSE. A settings page reading
 * "penalty.rate: 7" is not a rule anybody agreed to. The member-facing page
 * renders `body`, so the thing a member reads and the thing the software
 * applies are two faces of one record and cannot drift apart. Committees may
 * reword their own rules; the wording is stored per association for exactly
 * that reason, and these are only the defaults.
 *
 * THE DEFAULTS BELOW ARE RTA'S OWN RULES, as stated by the association:
 * 1,000 saved daily plus 50 service fee, a 7% fine after 7 missed days,
 * lending after six months, 80% of your own savings without collateral,
 * 2% a month over at most six months, and that 2% split half to the borrower's
 * savings and half to the association.
 */

export const RULE_KEYS = {
  // Contributions ----------------------------------------------------------
  DAILY_SAVINGS: "contribution.daily_savings",
  CATCH_UP_ALLOWED: "contribution.catch_up_allowed",

  // The platform's service fee ---------------------------------------------
  PLATFORM_FEE_DAILY: "platform_fee.daily",
  PLATFORM_FEE_SEPARATION: "platform_fee.separation",

  // Falling behind ---------------------------------------------------------
  PENALTY_GRACE_DAYS: "penalty.grace_days",
  PENALTY_RATE: "penalty.rate",
  PENALTY_BASIS: "penalty.basis",
  PENALTY_REPEAT_DAYS: "penalty.repeat_days",
  REMINDER_LEAD_DAYS: "penalty.reminder_lead_days",

  // Who may borrow ---------------------------------------------------------
  LENDING_UNLOCK_MONTHS: "lending.association_unlock_months",
  MEMBER_MINIMUM_MONTHS: "lending.member_minimum_months",
  OWN_SAVINGS_PERCENT: "lending.own_savings_percent",
  COLLATERAL_REQUIRED_ABOVE_SHARE: "lending.collateral_required_above_share",
  COLLATERAL_COVERAGE_PERCENT: "lending.collateral_coverage_percent",
  ARREARS_BLOCK_BORROWING: "lending.arrears_block",

  // On what terms ----------------------------------------------------------
  LOAN_MONTHLY_INTEREST: "loan.monthly_interest_percent",
  LOAN_MAX_TERM_MONTHS: "loan.maximum_term_months",
  LOAN_REPAYMENT_FREQUENCY: "loan.repayment_frequency",
  LOAN_NO_EXTRA_CHARGES: "loan.no_additional_charges",

  // Where the interest goes ------------------------------------------------
  INTEREST_MEMBER_POINTS: "interest.member_share_points",
  INTEREST_ASSOCIATION_POINTS: "interest.association_share_points",

  // How the rules themselves work ------------------------------------------
  RULES_PUBLISHED: "governance.rules_are_published",
  AMENDMENT_PROCESS: "governance.amendment_process",
} as const;

export type RuleKey = (typeof RULE_KEYS)[keyof typeof RULE_KEYS];

export interface RuleDefinition {
  key: RuleKey;
  category: RuleCategory;
  valueType: RuleValueType;
  enforcement: RuleEnforcement;
  /// Null for TEXT rules, which are policy prose with nothing to compute.
  defaultValue: string | null;
  displayOrder: number;
  title: { en: string; rw: string };
  body: { en: string; rw: string };
}

/**
 * The rules, in the order a member should meet them: what you owe, what the
 * fee is, what happens if you fall behind, when you may borrow, on what terms,
 * and where the interest goes.
 *
 * `displayOrder` is global rather than per-category so that reordering a rule
 * within its own group never silently reorders another group.
 */
export const RULE_CATALOGUE: readonly RuleDefinition[] = [
  // -------------------------------------------------------------------------
  // CONTRIBUTIONS
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.DAILY_SAVINGS,
    category: "CONTRIBUTIONS",
    valueType: "MONEY",
    enforcement: "AUTOMATIC",
    defaultValue: "1000.00",
    displayOrder: 10,
    title: {
      en: "Save every day",
      rw: "Kuzigama buri munsi",
    },
    body: {
      en: "Every member saves this amount each day. It is your own money: it goes straight into your savings account and stays yours. Together with the service fee below, one day costs you the two added together.",
      rw: "Buri munyamuryango azigama aya mafaranga buri munsi. Ni amafaranga yawe bwite: ajya mu konti yawe y'ubuzigame kandi akomeza kuba ayawe. Hamwe n'amafaranga ya serivisi ari hasi aha, umunsi umwe ugutwara ayo yombi ateranyijwe.",
    },
  },
  {
    key: RULE_KEYS.CATCH_UP_ALLOWED,
    category: "CONTRIBUTIONS",
    valueType: "BOOLEAN",
    enforcement: "AUTOMATIC",
    defaultValue: "true",
    displayOrder: 20,
    title: {
      en: "You may pay for several days at once",
      rw: "Ushobora kwishyura iminsi myinshi icyarimwe",
    },
    body: {
      en: "You do not have to pay every single day. What is counted is how many days your total payments cover, so paying a week at a time on market day is perfectly in order. You fall behind only when the days you have paid for fall behind the days that have passed.",
      rw: "Ntabwo usabwa kwishyura buri munsi. Icyo tubara ni umubare w'iminsi amafaranga wishyuye yose ahagarariye, bityo kwishyura icyumweru cyose ku munsi w'isoko ni byemewe rwose. Usigara inyuma gusa iyo iminsi wishyuriye iri hasi y'iminsi yashize.",
    },
  },

  // -------------------------------------------------------------------------
  // THE PLATFORM'S SERVICE FEE
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.PLATFORM_FEE_DAILY,
    category: "PLATFORM_FEE",
    valueType: "MONEY",
    enforcement: "AUTOMATIC",
    defaultValue: "50.00",
    displayOrder: 30,
    title: {
      en: "Daily service fee",
      rw: "Amafaranga ya serivisi ya buri munsi",
    },
    body: {
      en: "This pays for running the platform that keeps your record. It is charged for each day your contributions cover, and it is not savings — it does not build up in your account and it is not returned to you.",
      rw: "Aya afasha gukoresha urubuga rubika amakuru yawe. Asabwa kuri buri munsi amafaranga wishyuye ahagarariye, kandi si ubuzigame — ntiyiyongera muri konti yawe kandi ntagusubizwa.",
    },
  },
  {
    key: RULE_KEYS.PLATFORM_FEE_SEPARATION,
    category: "PLATFORM_FEE",
    valueType: "TEXT",
    enforcement: "AUTOMATIC",
    defaultValue: null,
    displayOrder: 40,
    title: {
      en: "The service fee is not the association's money",
      rw: "Amafaranga ya serivisi si aya ihuriro",
    },
    body: {
      en: "The fee is collected by the association but belongs to the platform operator. It is held in a separate record from the first day, is never counted as association income, and can never be lent out or shared among members. Any member can see the running total on the association's money page.",
      rw: "Aya mafaranga akusanywa n'ihuriro ariko ni aya nyir'urubuga. Abikwa mu bitabo bitandukanye uhereye ku munsi wa mbere, ntabwo na rimwe abarwa nk'inyungu z'ihuriro, kandi ntashobora na rimwe kugurizwa cyangwa kugabanywa abanyamuryango. Umunyamuryango wese ashobora kubona igiteranyo cyayo ku ipaji y'amafaranga y'ihuriro.",
    },
  },

  // -------------------------------------------------------------------------
  // FALLING BEHIND
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.PENALTY_GRACE_DAYS,
    category: "PENALTIES",
    valueType: "DAYS",
    enforcement: "AUTOMATIC",
    defaultValue: "7",
    displayOrder: 50,
    title: {
      en: "How many days you may miss before a fine",
      rw: "Iminsi ushobora gusiba mbere y'ihazabu",
    },
    body: {
      en: "Miss this many days of saving and a fine follows. You are warned before you reach it, and the exact number of days you are behind is on your dashboard every day.",
      rw: "Nusiba iyi minsi utazigamye, uhabwa ihazabu. Uburirwa mbere yo kuyigeraho, kandi umubare nyawo w'iminsi usigaye inyuma uboneka ku ipaji yawe buri munsi.",
    },
  },
  {
    key: RULE_KEYS.PENALTY_RATE,
    category: "PENALTIES",
    valueType: "PERCENT",
    enforcement: "AUTOMATIC",
    defaultValue: "7.0000",
    displayOrder: 60,
    title: {
      en: "The fine",
      rw: "Ihazabu",
    },
    body: {
      en: "The fine is this percentage of the savings you have not paid — not of everything you have saved. Missing seven days of 1,000 leaves 7,000 unpaid, and the fine on that is 490. The fine is owed to the association, not to the platform.",
      rw: "Ihazabu ni iyi ijanisha ry'ubuzigame utarishyuye — si iry'ibyo wazigamye byose. Gusiba iminsi irindwi ya 1,000 bisiga 7,000 atarishyuwe, ihazabu kuri ayo ni 490. Ihazabu igenerwa ihuriro, si urubuga.",
    },
  },
  {
    key: RULE_KEYS.PENALTY_BASIS,
    category: "PENALTIES",
    valueType: "TEXT",
    enforcement: "AUTOMATIC",
    defaultValue: null,
    displayOrder: 70,
    title: {
      en: "A fine never touches what you have already saved",
      rw: "Ihazabu ntabwo ikoraho ibyo wamaze kuzigama",
    },
    body: {
      en: "The fine is worked out from what you still owe, so a member who has saved for years is not fined more than a member who joined last month for the same missed week. The fine is recorded as owed and shown to you before anything is taken from your account, and an officer may waive it with a written reason.",
      rw: "Ihazabu ibarwa hashingiwe ku byo ukiriho, bityo umunyamuryango umaze imyaka azigama ntahabwa ihazabu iruta iy'uwinjiye ukwezi gushize ku cyumweru kimwe basibye. Ihazabu yandikwa nk'umwenda kandi ukayibona mbere y'uko hagira igikurwa muri konti yawe, kandi umuyobozi ashobora kuyireka atanze impamvu yanditse.",
    },
  },
  {
    key: RULE_KEYS.PENALTY_REPEAT_DAYS,
    category: "PENALTIES",
    valueType: "DAYS",
    enforcement: "AUTOMATIC",
    defaultValue: "7",
    displayOrder: 80,
    title: {
      en: "A further fine for every further stretch missed",
      rw: "Indi hazabu kuri buri kindi gice cy'iminsi wasibye",
    },
    body: {
      en: "If you stay behind, another fine follows after this many more missed days. The same arrears are never fined twice: each fine covers days the earlier ones did not.",
      rw: "Nukomeza gusigara inyuma, indi hazabu ikurikira nyuma y'iyi minsi yindi wasibye. Umwenda umwe ntabwo uhanirwa kabiri: buri hazabu ireba iminsi izindi zitarebye.",
    },
  },
  {
    key: RULE_KEYS.REMINDER_LEAD_DAYS,
    category: "PENALTIES",
    valueType: "DAYS",
    enforcement: "AUTOMATIC",
    defaultValue: "2",
    displayOrder: 90,
    title: {
      en: "You are warned before you are fined",
      rw: "Uburirwa mbere yo guhabwa ihazabu",
    },
    body: {
      en: "A reminder is sent this many days before you reach the fine, telling you exactly how much would clear it. Nobody should ever be fined by surprise.",
      rw: "Ubutumwa bwo kwibutsa buhabwa iyi minsi mbere y'uko ugera ku ihazabu, bukubwira neza amafaranga yayikuraho. Nta muntu ukwiye guhanwa atunguwe.",
    },
  },

  // -------------------------------------------------------------------------
  // WHO MAY BORROW
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.LENDING_UNLOCK_MONTHS,
    category: "LENDING_ELIGIBILITY",
    valueType: "MONTHS",
    enforcement: "AUTOMATIC",
    defaultValue: "6",
    displayOrder: 100,
    title: {
      en: "Lending starts after the association has saved this long",
      rw: "Kugurizanya bitangira nyuma y'uko ihuriro rimaze iki gihe rizigama",
    },
    body: {
      en: "The association builds its fund for this many months before it lends anything to anyone. Until then everybody saves and nobody borrows, so that the first loans are made from a pool that can actually carry them.",
      rw: "Ihuriro ryubaka ikigega cyaryo mu mezi angana atya mbere yo kugurizanya n'umwe. Kugeza icyo gihe buri wese arazigama nta n'umwe uguza, kugira ngo inguzanyo za mbere zive mu kigega gishoboye kuzihagarara.",
    },
  },
  {
    key: RULE_KEYS.MEMBER_MINIMUM_MONTHS,
    category: "LENDING_ELIGIBILITY",
    valueType: "MONTHS",
    enforcement: "AUTOMATIC",
    defaultValue: "6",
    displayOrder: 110,
    title: {
      en: "How long you must have been saving",
      rw: "Igihe ugomba kuba umaze uzigama",
    },
    body: {
      en: "You must have been contributing for this many months before you may apply. Your dashboard shows how long you have left.",
      rw: "Ugomba kuba umaze aya mezi uzigama mbere yo gusaba. Ipaji yawe ikwereka igihe gisigaye.",
    },
  },
  {
    key: RULE_KEYS.OWN_SAVINGS_PERCENT,
    category: "LENDING_ELIGIBILITY",
    valueType: "PERCENT",
    enforcement: "AUTOMATIC",
    defaultValue: "80.0000",
    displayOrder: 120,
    title: {
      en: "How much you may borrow against your own savings",
      rw: "Uko wagurizwa ushingiye ku buzigame bwawe",
    },
    body: {
      en: "You may borrow up to this share of your own savings with nothing else required. Your savings stay in your account and secure the loan; this part of a loan needs no collateral and no guarantor.",
      rw: "Ushobora kuguza kugeza kuri iyi ngano y'ubuzigame bwawe nta kindi usabwe. Ubuzigame bwawe busigara muri konti yawe bugatanga ingwate y'iyo nguzanyo; iki gice cy'inguzanyo nta ngwate cyangwa umwishingizi gisaba.",
    },
  },
  {
    key: RULE_KEYS.COLLATERAL_REQUIRED_ABOVE_SHARE,
    category: "LENDING_ELIGIBILITY",
    valueType: "BOOLEAN",
    enforcement: "AUTOMATIC",
    defaultValue: "true",
    displayOrder: 130,
    title: {
      en: "Borrowing more than your own share needs collateral",
      rw: "Kuguza hejuru y'igice cyawe bisaba ingwate",
    },
    body: {
      en: "Anything above your own share comes from the association's pooled money — that is other members' savings. To borrow it you must pledge something of your own: machines, materials, equipment, or any property the committee accepts and records.",
      rw: "Ibirenze igice cyawe biva mu kigega rusange cy'ihuriro — ubwo ni ubuzigame bw'abandi banyamuryango. Kugira ngo ubiguze ugomba gutanga ingwate yawe bwite: imashini, ibikoresho, cyangwa undi mutungo komite yemera kandi ikawandika.",
    },
  },
  {
    key: RULE_KEYS.COLLATERAL_COVERAGE_PERCENT,
    category: "LENDING_ELIGIBILITY",
    valueType: "PERCENT",
    enforcement: "ASSISTED",
    defaultValue: "100.0000",
    displayOrder: 140,
    title: {
      en: "What the collateral must be worth",
      rw: "Agaciro ingwate igomba kugira",
    },
    body: {
      en: "The pledged items must be worth at least this share of the amount borrowed above your own savings. The committee records what was pledged and what it was valued at, and both appear on the loan file.",
      rw: "Ibintu byatanzwe ho ingwate bigomba kugira agaciro nibura kangana na iyi ngano y'amafaranga waguze hejuru y'ubuzigame bwawe. Komite yandika icyatanzwe n'agaciro cyahawe, kandi byombi bigaragara ku idosiye y'inguzanyo.",
    },
  },
  {
    key: RULE_KEYS.ARREARS_BLOCK_BORROWING,
    category: "LENDING_ELIGIBILITY",
    valueType: "BOOLEAN",
    enforcement: "AUTOMATIC",
    defaultValue: "true",
    displayOrder: 150,
    title: {
      en: "You must be up to date to borrow",
      rw: "Ugomba kuba wishyuye byose kugira ngo uguze",
    },
    body: {
      en: "A member behind on their daily saving, or with a fine still owing, cannot take a new loan until it is cleared. Lending to somebody already behind is how an association loses both the loan and the member.",
      rw: "Umunyamuryango usigaye inyuma mu kuzigama kwa buri munsi, cyangwa ufite ihazabu akiriho, ntashobora gufata indi nguzanyo kugeza abikemuye. Kuguriza umuntu usanzwe asigaye inyuma ni ko ihuriro ritakaza inguzanyo n'umunyamuryango icyarimwe.",
    },
  },

  // -------------------------------------------------------------------------
  // ON WHAT TERMS
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.LOAN_MONTHLY_INTEREST,
    category: "LOAN_TERMS",
    valueType: "PERCENT",
    enforcement: "AUTOMATIC",
    defaultValue: "2.0000",
    displayOrder: 160,
    title: {
      en: "Interest on a loan",
      rw: "Inyungu ku nguzanyo",
    },
    body: {
      en: "Interest is this percentage a month, worked out on the amount borrowed. On 100,000 over six months that is 2,000 a month — 12,000 in total, and the schedule you sign shows every instalment before you take the money.",
      rw: "Inyungu ni iyi ijanisha ku kwezi, ibarwa ku mafaranga waguze. Kuri 100,000 mu mezi atandatu ni 2,000 ku kwezi — 12,000 yose hamwe, kandi gahunda yo kwishyura usinya ikwereka buri kwishyura mbere yo gufata amafaranga.",
    },
  },
  {
    key: RULE_KEYS.LOAN_MAX_TERM_MONTHS,
    category: "LOAN_TERMS",
    valueType: "MONTHS",
    enforcement: "AUTOMATIC",
    defaultValue: "6",
    displayOrder: 170,
    title: {
      en: "You have this long to repay",
      rw: "Ufite iki gihe cyo kwishyura",
    },
    body: {
      en: "Every loan is repaid within this many months. There is no extension, so borrow only what your monthly instalment can carry.",
      rw: "Buri nguzanyo yishyurwa muri aya mezi. Nta kongererwa igihe, bityo guza gusa ibyo kwishyura kwawe kwa buri kwezi gushoboye.",
    },
  },
  {
    key: RULE_KEYS.LOAN_REPAYMENT_FREQUENCY,
    category: "LOAN_TERMS",
    valueType: "TEXT",
    enforcement: "AUTOMATIC",
    defaultValue: null,
    displayOrder: 180,
    title: {
      en: "Repay every month",
      rw: "Wishyure buri kwezi",
    },
    body: {
      en: "Repayment is monthly, on the same date each month, and it does not replace your daily saving — the two run alongside each other. A reminder is sent before every instalment falls due.",
      rw: "Kwishyura ni buri kwezi, ku itariki imwe buri kwezi, kandi ntibisimbura kuzigama kwawe kwa buri munsi — byombi bikomeza icyarimwe. Ubutumwa bwo kwibutsa buhabwa mbere y'uko buri kwishyura kugera igihe.",
    },
  },
  {
    key: RULE_KEYS.LOAN_NO_EXTRA_CHARGES,
    category: "LOAN_TERMS",
    valueType: "BOOLEAN",
    enforcement: "AUTOMATIC",
    defaultValue: "true",
    displayOrder: 190,
    title: {
      en: "Nothing is charged beyond the stated interest",
      rw: "Nta kindi cyishyuzwa uretse inyungu yavuzwe",
    },
    body: {
      en: "No processing fee, no insurance fee, no file charge. What you repay is what you borrowed plus the interest above it, and the schedule shows the whole of it on the day the loan is approved.",
      rw: "Nta mafaranga yo gutunganya, nta ay'ubwishingizi, nta ay'idosiye. Icyo wishyura ni ibyo waguze hiyongereyeho inyungu yavuzwe, kandi gahunda yo kwishyura ikwereka byose ku munsi inguzanyo yemerewe.",
    },
  },

  // -------------------------------------------------------------------------
  // WHERE THE INTEREST GOES
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.INTEREST_MEMBER_POINTS,
    category: "INTEREST_SHARING",
    valueType: "PERCENT",
    enforcement: "AUTOMATIC",
    defaultValue: "1.0000",
    displayOrder: 200,
    title: {
      en: "Half the interest comes back to the borrower",
      rw: "Kimwe cya kabiri cy'inyungu kigarukira uwaguze",
    },
    body: {
      en: "Of the monthly interest, this much is credited straight back into the borrower's own savings account every time an instalment is paid. You are paying part of the interest to yourself, and it appears on your statement as an interest credit.",
      rw: "Muri inyungu ya buri kwezi, iyi ngano isubizwa ako kanya muri konti y'ubuzigame y'uwaguze buri gihe yishyuye. Uba wishyura igice cy'inyungu wowe ubwawe, kandi kigaragara ku nyandiko ya konti yawe nk'inyungu winjijwe.",
    },
  },
  {
    key: RULE_KEYS.INTEREST_ASSOCIATION_POINTS,
    category: "INTEREST_SHARING",
    valueType: "PERCENT",
    enforcement: "AUTOMATIC",
    defaultValue: "1.0000",
    displayOrder: 210,
    title: {
      en: "The other half builds the association's fund",
      rw: "Ikindi gice cyubaka ikigega cy'ihuriro",
    },
    body: {
      en: "The remainder of the monthly interest stays with the association. It is what allows the fund to grow beyond what members put in, and it is reported on the association's money page as lending income — separately from the service fee, which is not the association's at all.",
      rw: "Igice gisigaye cy'inyungu ya buri kwezi gisigara ku ihuriro. Ni cyo gituma ikigega kiyongera hejuru y'ibyo abanyamuryango bashyizemo, kandi kigaragazwa ku ipaji y'amafaranga y'ihuriro nk'inyungu zo kugurizanya — ukwacyo, kikaba gitandukanye n'amafaranga ya serivisi atari aya ihuriro na gato.",
    },
  },

  // -------------------------------------------------------------------------
  // HOW THE RULES THEMSELVES WORK
  // -------------------------------------------------------------------------
  {
    key: RULE_KEYS.RULES_PUBLISHED,
    category: "GOVERNANCE",
    valueType: "TEXT",
    enforcement: "AUTOMATIC",
    defaultValue: null,
    displayOrder: 220,
    title: {
      en: "Every member can read every rule",
      rw: "Buri munyamuryango ashobora gusoma buri tegeko",
    },
    body: {
      en: "These rules are on every member's dashboard, in their own language, with the exact figures the system applies. There is no second set of rules held anywhere else.",
      rw: "Aya mategeko ari ku ipaji ya buri munyamuryango, mu rurimi rwe, hamwe n'imibare nyayo sisitemu ikoresha. Nta yandi mategeko abitse ahandi.",
    },
  },
  {
    key: RULE_KEYS.AMENDMENT_PROCESS,
    category: "GOVERNANCE",
    valueType: "TEXT",
    enforcement: "AUTOMATIC",
    defaultValue: null,
    displayOrder: 230,
    title: {
      en: "How a rule is changed",
      rw: "Uko itegeko rihindurwa",
    },
    body: {
      en: "A rule is changed by the committee on this platform, and every change records who made it, when, and the reason given. The previous wording and figure are kept, so a member fined last year can still read the rule as it stood then.",
      rw: "Itegeko rihindurwa na komite kuri uru rubuga, kandi buri mpinduka yandika uwayikoze, ryari, n'impamvu yatanzwe. Amagambo n'umubare byari bisanzwe birabikwa, bityo umunyamuryango wahawe ihazabu umwaka ushize aracyashobora gusoma itegeko uko ryari rimeze icyo gihe.",
    },
  },
] as const;

/** Lookup by key. Built once — the catalogue never changes at runtime. */
export const RULE_BY_KEY: ReadonlyMap<string, RuleDefinition> = new Map(
  RULE_CATALOGUE.map((rule) => [rule.key as string, rule])
);

/**
 * The order categories are drawn in, on both the admin rulebook and the
 * member's page. Follows the member's own journey rather than the alphabet:
 * what you pay, what it costs, what happens if you slip, when you can borrow,
 * on what terms, and where the money ends up.
 */
export const RULE_CATEGORY_ORDER: readonly RuleCategory[] = [
  "CONTRIBUTIONS",
  "PLATFORM_FEE",
  "PENALTIES",
  "LENDING_ELIGIBILITY",
  "LOAN_TERMS",
  "INTEREST_SHARING",
  "GOVERNANCE",
  "OTHER",
] as const;

/**
 * Turns a rule value into a slug-safe key for a committee's own rule.
 *
 * Prefixed with `custom.` so a custom rule can never collide with a catalogue
 * key, which is what keeps `getPolicy()` from picking up a hand-written row
 * where it expects a system one.
 */
export function customRuleKey(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  // A title of pure punctuation would slug to nothing; fall back to a stamp
  // rather than minting `custom.`, which would collide with the next one.
  return `custom.${slug || `rule_${Date.now().toString(36)}`}`;
}
