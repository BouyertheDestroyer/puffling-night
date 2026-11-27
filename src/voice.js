// Spoken lines for everyone in town, through the browser's speech synthesis (which uses the
// operating system's voices). British English where the system has it.
export const LINES = {
  hit: ['Oi!', 'Ow! What was that for?', 'Leave it out!', 'You absolute muppet!', 'Bloody hell!', 'Do one, mate!', 'Not the face!', "I'm telling my mum!", 'Have a word with yourself!'],
  getUp: ['My head...', "Right. That's it.", "I'm writing to the council about this.", 'What a night.', 'Ow. Ow. Ow.'],
  flee: ['Help! Nutter!', 'Run!', 'Someone call the police!', 'Leg it!', 'Not again!'],
  jacked: ["Oi! That's my car!", "You can't just take my car!", "I've only just had it washed!", 'Bring that back, you toerag!'],
  pinched: ['Oi! Where have my pufflings gone?', 'Thief! Puffling thief!', 'Cheeky sod!', 'Give those back!'],
  greet: ['Evening.', 'Lovely night for it.', "Cold one, isn't it?", 'Mind the pufflings, love.', 'Seen any pufflings?', 'Bit nippy.', 'Alright?', 'Fancy a cuppa?', "It's a jungle out there."],
  zombie: ['Zombie! Leg it!', 'Is that a draugr?', 'Not tonight, thank you!', 'Keep away from me!'],
  honk: ['Get out of the road!', 'Move it, you plonker!', 'Some of us have places to be!', 'Are you blind?'],
  crashed: ['Watch it!', 'Learn to drive!', "That's coming out of your insurance!", 'Oh, come on!', 'My car!'],
  angry: ["Right, you're getting it now!", 'Come here!', 'You want some?'],
  catch: ['Got you.', 'In you go.', 'There we are, little one.', 'Gotcha.'],
  toss: ['Off you go!', 'Fly, little one!', 'Go on then!', 'Safe travels!'],
  ouch: ['Ow!', 'Oof!', 'Argh!'],
};

export class Voices {
  constructor(audio) {
    this.audio = audio;
    this.ok = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
    this.voices = []; this.busyUntil = 0; this.priority = 0;
    if (this.ok) {
      const load = () => {
        const all = speechSynthesis.getVoices();
        const gb = all.filter(v => /en[-_]GB/i.test(v.lang));
        const en = all.filter(v => /^en/i.test(v.lang));
        this.voices = gb.length ? gb : en.length ? en : all;
      };
      load(); speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }
  pick(kind) { const l = LINES[kind]; return l[Math.floor(Math.random() * l.length)]; }
  // who: { pitch, rate, voice } ; dist: metres from the listener
  say(kind, who = {}, dist = 0, priority = 1) {
    const text = LINES[kind] ? this.pick(kind) : kind;
    if (!this.ok || this.audio.muted || dist > 40) return text;
    const now = performance.now();
    if (now < this.busyUntil && priority <= this.priority) return text;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      if (this.voices.length) u.voice = this.voices[(who.voice ?? 0) % this.voices.length];
      u.pitch = who.pitch ?? 1; u.rate = who.rate ?? 1.05;
      u.volume = Math.max(0.15, Math.min(1, 1.15 - dist / 30));
      speechSynthesis.speak(u);
      this.busyUntil = now + 400 + text.length * 70; this.priority = priority;
    } catch {}
    return text;
  }
  hush() { if (this.ok) try { speechSynthesis.cancel(); } catch {} this.busyUntil = 0; }
}
