// Adjective 1: opinion, size, age, shape (first position in English adjective order)
const ADJECTIVES_1 = [
  // opinion
  'silly', 'funny', 'brave', 'jolly', 'witty', 'wild', 'bold', 'lucky', 'happy', 'quirky',
  'clever', 'calm', 'eager', 'merry', 'kind',
  // size
  'tiny', 'little', 'mini', 'large', 'giant', 'tall', 'slim', 'grand', 'vast', 'huge',
  'petite', 'great',
  // age
  'ancient', 'young', 'modern', 'fresh', 'classic', 'eternal', 'timeless', 'early',
  // shape
  'round', 'oval', 'flat', 'curved', 'narrow', 'hollow', 'crisp', 'sharp', 'smooth', 'steep',
];

// Adjective 2: color, origin, material, purpose (second position in English adjective order)
const ADJECTIVES_2 = [
  // color
  'red', 'blue', 'green', 'amber', 'silver', 'violet', 'cyan', 'jade', 'teal', 'coral',
  'ivory', 'azure', 'golden', 'crimson', 'scarlet', 'cobalt', 'indigo', 'olive', 'pink', 'rose',
  // origin
  'arctic', 'alpine', 'coastal', 'forest', 'ocean', 'lunar', 'solar', 'polar', 'urban',
  'highland', 'valley', 'desert', 'tropical', 'nordic', 'eastern', 'western',
  // material
  'wooden', 'marble', 'crystal', 'iron', 'steel', 'copper', 'glass', 'stone', 'velvet',
  'cedar', 'maple', 'granite', 'bronze', 'woven', 'flint', 'birch',
  // purpose
  'noble', 'prime', 'bright', 'royal', 'sacred', 'silent', 'mystic', 'cosmic', 'radiant',
  'steady', 'keen',
];

const NOUNS = [
  // animals
  'badger', 'falcon', 'ferret', 'otter', 'raven', 'gecko', 'panda', 'jaguar', 'narwhal',
  'quokka', 'axolotl', 'capybara', 'wombat', 'dingo', 'lemur', 'marmot', 'tapir', 'viper',
  // objects / tools
  'anvil', 'lantern', 'compass', 'sextant', 'pendulum', 'prism', 'dynamo', 'turbine',
  'wrench', 'chisel', 'piston', 'sprocket', 'pulley', 'bellows', 'lathe',
  // celestial / scientific
  'comet', 'photon', 'neutron', 'quasar', 'nebula', 'pulsar', 'proton', 'cyclone',
  // whimsical / abstract
  'riddle', 'fable', 'cipher', 'totem', 'sigil', 'emblem', 'omen', 'mantra', 'lore',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomHostname(): string {
  return `${pick(ADJECTIVES_1)}-${pick(ADJECTIVES_2)}-${pick(NOUNS)}`;
}
