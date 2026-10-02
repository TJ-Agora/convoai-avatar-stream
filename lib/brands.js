// Brand registry — opt-in "brand packs" for prospect-specific demos.
//
// A brand is chosen on the setup page via `/?brand=<id>` (mirrors
// `/?avatar=lemonslice`), persisted in channel meta, and broadcast in every
// state snapshot. The server builds the agent's system prompt and greeting
// from it; clients key the theme (`data-brand` CSS token overrides) and copy
// off it. Host and guest links carry no params — the channel remembers.
//
// Plain ESM with no secrets: imported by server modules AND client pages.
// Seller voice ids / image URLs are public identifiers, not credentials.
//
// Sellers: a brand may list named partner personas. The client sends only a
// sellerId; createChannel resolves image/voice/bio here so nothing persona-
// related is trusted from the request body.

const SPOKEN_RULES = [
  'Your words are spoken aloud by a live avatar — always reply in natural spoken prose. Never use numbered lists, bullet points, headings, or any written formatting.',
];

// --- default: the generic AI Avatar Stream host (unchanged from main) ---

function defaultSystemPrompt(title, topic) {
  return [
    `You are a friendly live host running a 1-to-many stream${title ? ` called "${title}"` : ''}.`,
    topic ? `The topic of this stream is: ${topic}.` : '',
    'Answer audience questions warmly and concisely — usually 1 to 3 sentences.',
    ...SPOKEN_RULES,
    'When several questions arrive together, respond like a live host reading the chat: weave the answers into one flowing reply, group related questions, and address people by name when it feels natural. Make sure every question gets answered, then invite more.',
    'Keep the energy up and conversational. Never mention that you are an AI model unless you are directly asked.',
  ].filter(Boolean).join(' ');
}

function defaultGreeting(title) {
  return `Hey everyone, welcome${title ? ` to ${title}` : ''}! I'm your host. Drop your questions in the chat and I'll answer them live.`;
}

// --- thredup: live seller on a secondhand-fashion stream ---
//
// No catalog or checkout exists in the demo, so product specifics (prices,
// sizes, condition) come only from the host — the stream topic at setup, or
// Think prompts mid-stream ("Now showing a Coach crossbody, like new, $48").

function thredupSystemPrompt(title, topic, seller) {
  const stream = `a 1-to-many shopping stream${title ? ` called "${title}"` : ''} on thredUP, the online secondhand fashion marketplace`;
  return [
    seller
      ? `You are ${seller.name}, a live seller hosting ${stream}. About you: ${seller.bio}`
      : `You are a friendly, upbeat live seller hosting ${stream}.`,
    topic ? `What you are showing today: ${topic}.` : '',
    'You showcase pre-loved women\'s and kids\' clothing, shoes, handbags, and accessories — everything from everyday brands to designer labels — and you love a great find at a fraction of retail.',
    'Talk about pieces the way a great live seller does: fabric, fit, sizing, how to style it, what condition it is in (new with tags, like new, or gently used), and why it is a steal secondhand. Give real, practical fit and styling advice when asked.',
    'Celebrate thrifting: buying secondhand keeps clothes out of landfills and lets people wear great brands for less.',
    'Only quote specific prices, sizes, brands, or conditions the host has given you (in what you are showing today or in a host note). Otherwise describe value in general terms like "a fraction of retail" and never invent item numbers, stock levels, or purchase confirmations. If someone wants to buy, tell them the host will drop the item link and to grab it there. If you do not know a detail about a piece, say so and offer your best styling take instead.',
    'Answer shopper questions warmly and concisely — usually 1 to 3 sentences.',
    ...SPOKEN_RULES,
    'When several questions arrive together, respond like a live seller reading the chat: weave the answers into one flowing reply, group related questions, and address people by name when it feels natural. Make sure every question gets answered, then keep the energy up and tease the next find.',
    seller
      ? `Keep it fun, confident, and conversational, in ${seller.name}'s voice. If someone asks whether you are really ${seller.name} or an AI, be honest that you are an AI avatar of ${seller.name} created for this stream, then carry on.`
      : 'Keep it fun, confident, and conversational. Never mention that you are an AI model unless you are directly asked.',
  ].filter(Boolean).join(' ');
}

// Greetings MUST start with "Hey everyone" — tests filter the greeting bubble
// out of the feed by that prefix.
function thredupGreeting(title, seller) {
  const welcome = `welcome${title ? ` to ${title}` : ''}!`;
  const rest = "I've got some amazing secondhand finds lined up for you today. Drop your questions about anything you see and I'll answer them live.";
  return seller
    ? `Hey everyone, it's ${seller.name} — ${welcome} ${rest}`
    : `Hey everyone, ${welcome} ${rest}`;
}

export const BRANDS = {
  default: {
    id: 'default',
    label: 'AI Avatar Stream',
    wordmark: '',            // text wordmark rendered by <BrandMark>; '' = none
    tagline: '',             // promo-bar line rendered by <PromoBar>; '' = none
    defaultTitle: 'Product AMA',
    topicLabel: 'TOPIC (OPTIONAL)',
    topicPlaceholder: 'What should the avatar be knowledgeable about?',
    systemPrompt: defaultSystemPrompt,
    greeting: defaultGreeting,
    batchIntro: 'Here are the questions from the room since your last answer:',
    batchStyle: 'like a live host reading the chat',
    sellers: [],
  },
  thredup: {
    id: 'thredup',
    label: 'thredUP Live',
    wordmark: 'THREDUP',
    tagline: 'Secondhand style for every version of you.',
    defaultTitle: 'thredUP Live Finds',
    topicLabel: "WHAT YOU'RE SHOWING (OPTIONAL)",
    topicPlaceholder: "e.g. fall handbags, kids' outerwear, designer denim under $60",
    systemPrompt: thredupSystemPrompt,
    greeting: thredupGreeting,
    batchIntro: 'Here are the questions from shoppers in the room since your last answer:',
    batchStyle: 'like a live seller reading the chat',
    // Partner personas. avatarImageUrl / voiceId left empty fall back to the
    // LEMONSLICE_AVATAR_ID / MINIMAX_VOICE_ID env defaults — fill in when the
    // partner's assets arrive. The image must be a PUBLIC https URL
    // (Lemonslice fetches it server-side), portrait ≈368×560, under 4MB.
    sellers: [
      {
        id: 'nava',
        name: 'Nava',   // TODO confirm display name + bio with the partner
        bio: 'A thredUP creator known for curated secondhand finds and honest, practical styling advice.',
        avatarVendor: 'lemonslice',
        avatarImageUrl: 'https://agora-sa-demo-bucket.s3.us-east-1.amazonaws.com/public-folder/threadup/nava.jpg',
        voiceId: '',    // Minimax STOCK voice id; '' = MINIMAX_VOICE_ID env default
      },
    ],
  },
};

export const BRAND_IDS = Object.keys(BRANDS);

export function getBrand(id) {
  return BRANDS[id] || BRANDS.default;
}

export function getSeller(brandId, sellerId) {
  if (!sellerId) return null;
  return getBrand(brandId).sellers.find((s) => s.id === sellerId) || null;
}

// Batched-mode prompt. No numbering — numbered input invites a numbered
// answer, which sounds robotic when spoken. Present the batch as a chat log.
export function buildBatchPrompt(brandId, questions) {
  const brand = getBrand(brandId);
  const lines = questions
    .map((q) => `${q.user || 'Someone'}: ${q.text}`)
    .join('\n');
  return `${brand.batchIntro}\n${lines}\n\nRespond to the room in one natural, flowing spoken reply — ${brand.batchStyle}. Cover every question, group related ones together, and mention people by name where it helps. Do not enumerate or number your answers.`;
}
