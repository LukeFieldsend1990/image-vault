/**
 * Generates memorable two-word aliases (adjective-noun).
 * e.g. brave-falcon@changling.io
 *
 * ~200 adjectives × ~200 nouns = 40,000 unique combos.
 */

const ADJECTIVES = [
  "agile","amber","ancient","arctic","astral","autumn","azure","bitter","blazing",
  "bold","brave","bright","bronze","calm","cedar","clever","cobalt","cool","copper",
  "coral","cosmic","crisp","crystal","dapper","dark","dawn","deep","desert","divine",
  "dusk","eager","earthy","ember","epic","eternal","fading","fair","fallen","fast",
  "feral","fierce","flint","forest","fossil","fresh","frost","gentle","gilded","glass",
  "golden","grand","gravel","green","grey","grim","harbor","hardy","haze","hidden",
  "hollow","honey","humble","hushed","icy","idle","indigo","inner","iron","ivory",
  "jade","jagged","jolly","keen","kind","lapis","late","light","lime","liquid",
  "little","lone","lost","loyal","lucid","lunar","marble","meadow","mellow","mighty",
  "misty","molten","mossy","muted","narrow","neat","nimble","noble","north","oak",
  "ocean","olive","onyx","opal","open","outer","pale","paper","pearl","pine",
  "plain","polar","polite","primal","prime","proud","pure","quartz","queen","query",
  "quick","quiet","rapid","rare","raven","ready","red","regal","ridge","risen",
  "river","rocky","rowan","royal","ruby","rugged","rustic","sable","sage","sandy",
  "scarlet","serene","shadow","sharp","sheer","shell","shield","silent","silk","silver",
  "slate","sleek","slim","smoke","snowy","soft","solar","solid","south","spark",
  "spice","stark","steady","steel","still","stone","storm","stout","sunny","super",
  "sweet","swift","tawny","tender","thorn","tidal","timber","topaz","tough","trail",
  "trim","true","tulip","twin","upper","urban","vast","velvet","vivid","warm",
  "west","white","whole","wild","windy","winter","wise","witty","young","zeal",
];

const NOUNS = [
  "anchor","badger","beacon","bear","birch","blade","bloom","bolt","brook","brush",
  "canyon","cedar","cliff","cloud","comet","cove","crane","creek","crest","crow",
  "dale","dawn","deer","delta","dune","eagle","echo","edge","elk","ember",
  "falcon","fern","finch","flame","flare","flint","forge","fox","frost","gate",
  "glade","grove","guild","gull","hare","haven","hawk","heath","hedge","heron",
  "hill","hollow","horn","horse","isle","ivy","jade","jay","jewel","keel",
  "knight","lake","lance","lark","laurel","leaf","ledge","light","lily","linden",
  "lion","lotus","lynx","maple","marsh","mast","meadow","mesa","mill","mint",
  "mist","moon","moose","moth","nest","north","oak","orchid","otter","owl",
  "palm","panther","pass","path","peak","pearl","pine","plume","pond","poplar",
  "quail","quartz","quest","rail","rain","raven","reef","ridge","river","robin",
  "rock","rose","sage","sail","sand","scout","shade","shore","slope","smoke",
  "snow","spark","spire","spring","spruce","star","stone","stork","stream","summit",
  "swan","temple","thistle","thorn","thrush","tide","tiger","torch","tower","trail",
  "trout","vale","valley","veil","vine","violet","vista","void","warden","wave",
  "whale","willow","wind","wing","wolf","wren","yarrow","yew","zenith","zephyr",
];

export function generateAlias(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);

  const adj = ADJECTIVES[bytes[0] % ADJECTIVES.length];
  const noun = NOUNS[bytes[1] % NOUNS.length];

  return `${adj}-${noun}`;
}

export const INBOUND_DOMAIN = "changling.io";

export function fullAddress(alias: string): string {
  return `${alias}@${INBOUND_DOMAIN}`;
}
