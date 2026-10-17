'use strict';
/* पटकथा — screenplay. Based on the Karna Parva of Vyasa's Mahabharata.
   Each entry is one shot. L = dialogue lines [speaker, text, optional duration]; a bare number is a pause.
   Shot length grows to fit its lines; `min` sets a floor. */

const CAST = {
  N:  { name: 'सूत्रधार', color: '#efe4cc', pitch: 0.9, rate: 0.9 },
  K:  { name: 'कर्ण', color: '#ffb44f', pitch: 0.72, rate: 0.92 },
  A:  { name: 'अर्जुन', color: '#b5dcff', pitch: 1.0, rate: 0.98 },
  KR: { name: 'श्रीकृष्ण', color: '#72e6d4', pitch: 1.1, rate: 0.9 },
  S:  { name: 'शल्य', color: '#dcc08f', pitch: 0.82, rate: 1.04 },
  AS: { name: 'अश्वसेन', color: '#a6ff86', pitch: 0.55, rate: 0.85 },
  P:  { name: 'परशुराम', color: '#ff8a66', pitch: 0.6, rate: 0.88 },
};

const CHAPTERS = [
  'प्रस्तावना', 'सत्रहवाँ दिन', 'दो महारथी', 'पहला प्रहार', 'दिव्यास्त्रों का युद्ध',
  'नागास्त्र', 'शाप', 'धर्म का प्रश्न', 'अंजलिकास्त्र', 'सूर्य में विलीन',
];

// astra colours are shared by shots, cards and the page's अस्त्र-कोश
const ASTRA = {
  agni:     { name: 'आग्नेयास्त्र', roman: 'Agneyastra', col: [255, 110, 30], mantra: 'ॐ अग्नये नमः', deity: 'अग्निदेव', by: 'अर्जुन', power: 'आकाश से अग्नि की वर्षा — शत्रु-सेना भस्म' },
  varuna:   { name: 'वरुणास्त्र', roman: 'Varunastra', col: [80, 182, 255], mantra: 'ॐ वरुणाय नमः', deity: 'वरुणदेव', by: 'कर्ण', power: 'घनघोर मेघ और जलधारा — अग्नि शांत' },
  vayu:     { name: 'वायव्यास्त्र', roman: 'Vayavyastra', col: [200, 244, 255], mantra: 'ॐ वायवे नमः', deity: 'वायुदेव', by: 'अर्जुन', power: 'प्रचंड आँधी — कर्ण के मेघ छिन्न-भिन्न' },
  indra:    { name: 'ऐन्द्रास्त्र', roman: 'Aindrastra', col: [255, 226, 106], mantra: 'ॐ इन्द्राय नमः', deity: 'देवराज इन्द्र', by: 'अर्जुन', power: 'आकाश से सहस्रों बाणों की बौछार, वज्र-सी गर्जना' },
  bhargava: { name: 'भार्गवास्त्र', roman: 'Bhargavastra', col: [212, 107, 255], mantra: 'ॐ भार्गवाय नमः', deity: 'भृगुवंशी परशुराम', by: 'कर्ण', power: 'ऐन्द्रास्त्र के बाण काट डाले, पांचाल सेना में हाहाकार' },
  naga:     { name: 'नागास्त्र', roman: 'Sarpamukha Bana', col: [125, 255, 106], mantra: '', deity: 'नाग अश्वसेन', by: 'कर्ण', power: 'एक ही प्रहार में प्राण-हरण' },
  brahma:   { name: 'ब्रह्मास्त्र', roman: 'Brahmastra', col: [255, 243, 192], mantra: 'ॐ ब्रह्मणे नमः', deity: 'ब्रह्मा', by: 'कर्ण', power: 'परशुराम के शाप से मंत्र विस्मृत' },
  anjalika: { name: 'अंजलिकास्त्र', roman: 'Anjalikastra', col: [255, 213, 74], mantra: 'ॐ सत्याय नमः', deity: 'अर्जुन का सत्य-संकल्प', by: 'अर्जुन', power: 'इन्द्र के वज्र और यम के दण्ड-सा अंतिम बाण' },
};

const astraCard = (k, side, extra) => ({
  kicker: 'दिव्यास्त्र', title: ASTRA[k].name, roman: ASTRA[k].roman, side, col: ASTRA[k].col,
  rows: extra || [['देवता', ASTRA[k].deity], ['चलाया', ASTRA[k].by], ['शक्ति', ASTRA[k].power]],
});

const SCRIPT = [
  // १ प्रस्तावना
  { ch: 0, type: 'void', mus: 'calm', lead: 2.8, min: 8, fadeIn: 2.5, L: [
    ['N', 'कुरुक्षेत्र। महाभारत युद्ध का सत्रहवाँ दिन।'],
    ['N', 'पितामह भीष्म शरशय्या पर हैं। गुरु द्रोण वीरगति पा चुके हैं।'],
    ['N', 'आज कौरव सेना का सेनापति है — अंगराज कर्ण।'],
    ['N', 'और उसका लक्ष्य केवल एक है — अर्जुन।'],
  ] },
  // २ सत्रहवाँ दिन
  { ch: 1, type: 'dawn', mus: 'dawn', lead: 9.6, fadeIn: 1.2,
    caps: [[1.3, 'पाञ्चजन्य — श्रीकृष्ण का शंख', 3.6], [5.3, 'देवदत्त — अर्जुन का शंख', 3.6]],
    fx: [[1.2, 'shankh', { f: 233, d: 3.8 }], [5.2, 'shankh', { f: 311, d: 3.6 }]], L: [
    ['N', 'एक ओर सूर्यपुत्र कर्ण — जिसने इन्द्र को अपने कवच-कुंडल तक दान कर दिए।'],
    ['N', 'दूसरी ओर इन्द्रपुत्र अर्जुन — जिसके सारथी स्वयं श्रीकृष्ण हैं।'],
  ] },
  { ch: 1, type: 'title', mus: 'hit', min: 8, flashIn: 0.7 },
  // ३ दो महारथी
  { ch: 2, type: 'run', who: 'A', mus: 'march', min: 8.5, card: {
    kicker: 'महारथी', title: 'अर्जुन', roman: 'पार्थ · धनंजय · सव्यसाची', side: 'right', col: [181, 220, 255],
    rows: [['धनुष', 'गांडीव — अग्निदेव से प्राप्त'], ['रथ', 'श्वेत अश्व · ध्वजा पर हनुमान'], ['सारथी', 'श्रीकृष्ण'], ['शंख', 'देवदत्त']] } },
  { ch: 2, type: 'run', who: 'K', mus: 'march', min: 8.5, card: {
    kicker: 'महारथी', title: 'कर्ण', roman: 'राधेय · सूर्यपुत्र · अंगराज', side: 'left', col: [255, 180, 79],
    rows: [['धनुष', 'विजय — विश्वकर्मा निर्मित, परशुराम से प्राप्त'], ['ध्वजा', 'हस्तिकक्ष्या (हाथी की रस्सी)'], ['सारथी', 'मद्रराज शल्य'], ['गुरु', 'भगवान परशुराम']] } },
  { ch: 2, type: 'bust', who: 'K', mus: 'talk', L: [
    ['K', 'मद्रराज! रथ अर्जुन की ओर ले चलो।'],
    ['K', 'आज इस रणभूमि में या तो अर्जुन रहेगा — या कर्ण।'],
  ] },
  { ch: 2, type: 'bust', who: 'S', mus: 'talk', L: [
    ['S', 'इतना अभिमान ठीक नहीं, राधेय।'],
    ['S', 'अर्जुन के सामने तुम वैसे ही हो, जैसे हंसों के सामने कौआ।'],
  ] },
  { ch: 2, type: 'bust', who: 'K', mood: 'angry', mus: 'talk', L: [
    ['K', 'शल्य! तुम मेरे सारथी हो, शत्रु के चारण नहीं।'],
    ['K', 'अपनी जीभ को लगाम दो — और रथ हाँको!'],
  ] },
  { ch: 2, type: 'bust', who: 'A', mus: 'talk', L: [
    ['A', 'केशव, रथ कर्ण के सामने ले चलिए।'],
    ['A', 'आज अभिमन्यु की मृत्यु का हिसाब होगा।'],
  ] },
  { ch: 2, type: 'bust', who: 'KR', mus: 'talk', L: [
    ['KR', 'सावधान, पार्थ। कर्ण साधारण योद्धा नहीं है।'],
    ['KR', 'उसके बाणों में सूर्य का तेज है, और गुरु परशुराम की विद्या।'],
  ] },
  // ४ पहला प्रहार
  { ch: 3, type: 'wide', mode: 'exchange', mus: 'battle', min: 10, hit: true },
  { ch: 3, type: 'bust', who: 'KR', mood: 'smile', mus: 'talk', L: [['KR', 'वाह कर्ण, वाह!']] },
  { ch: 3, type: 'bust', who: 'A', mus: 'talk', L: [['A', 'माधव! मेरे बाण उसका रथ कई हाथ पीछे धकेलते हैं, और आप उसकी प्रशंसा करते हैं?']] },
  { ch: 3, type: 'bust', who: 'KR', mus: 'talk', L: [
    ['KR', 'पार्थ, इस रथ पर स्वयं मैं बैठा हूँ, और ध्वजा पर हनुमान।'],
    ['KR', 'फिर भी उसके बाण इसे पीछे धकेल देते हैं। सोचो — वह कैसा धनुर्धर है!'],
  ] },
  // ५ दिव्यास्त्रों का युद्ध
  { ch: 4, type: 'invoke', who: 'A', astra: 'agni', mus: 'astra', min: 3.6, lead: 0.9, L: [['A', 'आग्नेयास्त्र!', 2.2]] },
  { ch: 4, type: 'astra', kind: 'agni', mus: 'astra', min: 8, hit: true, card: astraCard('agni', 'left') },
  { ch: 4, type: 'invoke', who: 'K', astra: 'varuna', mus: 'astra', min: 3.6, lead: 0.9, L: [['K', 'वरुणास्त्र!', 2.2]] },
  { ch: 4, type: 'astra', kind: 'varuna', mus: 'astra', min: 8, hit: true, card: astraCard('varuna', 'right') },
  { ch: 4, type: 'invoke', who: 'A', astra: 'vayu', mus: 'astra', min: 3.6, lead: 0.9, L: [['A', 'वायव्यास्त्र!', 2.2]] },
  { ch: 4, type: 'astra', kind: 'vayu', mus: 'astra', min: 7.5, hit: true, card: astraCard('vayu', 'left') },
  { ch: 4, type: 'invoke', who: 'A', astra: 'indra', mus: 'astra', min: 3.6, lead: 0.9, L: [['A', 'ऐन्द्रास्त्र!', 2.2]] },
  { ch: 4, type: 'astra', kind: 'indra', mus: 'astra', min: 8, hit: true, card: astraCard('indra', 'left') },
  { ch: 4, type: 'invoke', who: 'K', astra: 'bhargava', mus: 'astra', min: 4, lead: 0.8, L: [['K', 'यह गुरु परशुराम का भार्गवास्त्र है, अर्जुन! रोक सको तो रोको!']] },
  { ch: 4, type: 'astra', kind: 'bhargava', mus: 'astra', min: 8.5, hit: true, card: astraCard('bhargava', 'right') },
  { ch: 4, type: 'bust', who: 'KR', mood: 'urgent', mus: 'battle', L: [['KR', 'पार्थ! भार्गवास्त्र हमारी सेना को भस्म कर रहा है। संभलो!']] },
  { ch: 4, type: 'wide', mode: 'storm', mus: 'battle', min: 8, lead: 2.2, L: [['N', 'फिर दोनों ओर से ऐसी बाण-वर्षा हुई कि आकाश ढक गया, और सूर्य भी छिप गया।']] },
  // ६ नागास्त्र
  { ch: 5, type: 'quiver', mus: 'tension', fadeIn: 0.6, lead: 1.2,
    card: astraCard('naga', 'left', [['भीतर', 'तक्षक-पुत्र नाग अश्वसेन'], ['बैर', 'खांडव-दहन में अर्जुन के कारण माता की मृत्यु'], ['लक्ष्य', 'अर्जुन का शीश']]), L: [
    ['N', 'तब कर्ण ने वह बाण निकाला, जिसे वह वर्षों से चंदन के चूर्ण में रखकर पूजता आया था।'],
    ['N', 'सर्पमुख बाण — जिसमें छिपा था नाग अश्वसेन।'],
  ] },
  { ch: 5, type: 'bust', who: 'S', mus: 'tension', L: [['S', 'कर्ण! यह बाण गर्दन पर नहीं, छाती पर साधो।']] },
  { ch: 5, type: 'bust', who: 'K', mood: 'resolve', mus: 'tension', L: [['K', 'शल्य, कर्ण दो बार लक्ष्य नहीं साधता।']] },
  { ch: 5, type: 'nagaFlight', mus: 'silence', min: 4.6 },
  { ch: 5, type: 'press', mus: 'battle', lead: 2.4, hit: true, L: [['N', 'उसी क्षण श्रीकृष्ण ने पैरों से रथ को दबा दिया — रथ एक हाथ धरती में धँस गया, घोड़े घुटनों पर आ गए।']] },
  { ch: 5, type: 'crown', mus: 'battle', lead: 1.6, L: [['N', 'नागास्त्र अर्जुन का शीश नहीं, केवल इन्द्र का दिया किरीट ले उड़ा।']] },
  { ch: 5, type: 'serpent', mus: 'tension', lead: 1.0, L: [['AS', 'कर्ण! मुझे फिर से चलाओ। इस बार अर्जुन नहीं बचेगा।']] },
  { ch: 5, type: 'bust', who: 'K', mood: 'resolve', mus: 'talk', L: [
    ['K', 'नहीं, नाग। कर्ण किसी दूसरे के बल पर विजय नहीं चाहता।'],
    ['K', 'सौ अर्जुन भी सामने हों, तो भी कर्ण एक बाण दो बार नहीं चलाता।'],
  ] },
  { ch: 5, type: 'wide', mode: 'serpentDeath', mus: 'battle', min: 7, lead: 3.4, L: [['N', 'क्रोधित अश्वसेन स्वयं अर्जुन पर झपटा — और अर्जुन के छह बाणों ने उसे काट गिराया।']] },
  // ७ शाप
  { ch: 6, type: 'wheel', mus: 'tension', fadeIn: 0.5, lead: 1.6, L: [
    ['N', 'तभी धरती ने कर्ण के रथ का पहिया निगल लिया।'],
    ['N', 'यह एक ब्राह्मण का शाप था, जिसकी होम-धेनु का बछड़ा कर्ण के बाण से अनजाने में मारा गया था।'],
  ] },
  { ch: 6, type: 'invoke', who: 'K', astra: 'brahma', fail: true, mus: 'tension', min: 6, lead: 0.8, L: [
    ['K', 'ब्रह्मास्त्र!', 2.2], 0.4,
    ['K', 'मंत्र... मंत्र याद क्यों नहीं आ रहा?'],
  ] },
  { ch: 6, type: 'flashback', phase: 0, mus: 'flash', fadeIn: 1.2, lead: 1.2, L: [
    ['N', 'वर्षों पहले — महेन्द्र पर्वत पर गुरु परशुराम का आश्रम।'],
    ['P', 'इतनी पीड़ा सहने वाला ब्राह्मण नहीं हो सकता। सच बताओ — कौन हो तुम?'],
    ['K', 'गुरुदेव... मैं सूतपुत्र कर्ण हूँ।'],
  ] },
  { ch: 6, type: 'flashback', phase: 1, mus: 'flash', lead: 0.8, hit: true, L: [
    ['P', 'तुमने अपने गुरु से छल किया है!'],
    ['P', 'जिस दिन इस विद्या की सबसे अधिक आवश्यकता होगी — उसी दिन तुम इसे भूल जाओगे!'],
  ] },
  // ८ धर्म का प्रश्न
  { ch: 7, type: 'wide', mode: 'dharma', mus: 'talk', fadeIn: 0.8, lead: 1.4, L: [
    ['K', 'रुको, अर्जुन! मेरा रथ धँस गया है।'],
    ['K', 'भूमि पर खड़े योद्धा पर बाण चलाना धर्म नहीं। तुम धर्म जानते हो — क्षण भर रुको।'],
  ] },
  { ch: 7, type: 'bust', who: 'KR', mood: 'fierce', mus: 'rise', L: [
    ['KR', 'आज तुम्हें धर्म याद आ रहा है, राधेय?'],
    ['KR', 'जब भरी सभा में द्रौपदी का अपमान हुआ — तब तुम्हारा धर्म कहाँ गया था?'],
    ['KR', 'जब जुए में छल से युधिष्ठिर का सब कुछ छीना गया — तब तुम्हारा धर्म कहाँ गया था?'],
    ['KR', 'जब छह महारथियों ने मिलकर बालक अभिमन्यु को मारा —'],
    ['KR', 'क्व ते धर्मस्तदा गतः? तब कहाँ गया था तुम्हारा धर्म, कर्ण?'],
  ] },
  { ch: 7, type: 'bust', who: 'K', mood: 'shame', mus: 'tension', lead: 1.2, L: [['N', 'कर्ण ने कोई उत्तर नहीं दिया। लज्जा से उसका सिर झुक गया — पर उसने धनुष नहीं छोड़ा।']] },
  { ch: 7, type: 'wide', mode: 'chestHit', mus: 'battle', lead: 2.2, hit: true, L: [['N', 'भूमि पर खड़े कर्ण ने ऐसा बाण मारा कि अर्जुन क्षण भर को विचलित हो उठे।']] },
  { ch: 7, type: 'wide', mode: 'flagCut', mus: 'battle', lead: 2.4, L: [['N', 'संभलते ही अर्जुन ने कर्ण की हस्तिकक्ष्या ध्वजा काट गिराई।']] },
  { ch: 7, type: 'bust', who: 'KR', mood: 'urgent', mus: 'battle', L: [['KR', 'पार्थ! इससे पहले कि कर्ण रथ पर चढ़े — बाण चलाओ!']] },
  // ९ अंजलिकास्त्र
  { ch: 8, type: 'invoke', who: 'A', astra: 'anjalika', mus: 'climax', min: 9, lead: 1.6, card: astraCard('anjalika', 'left', [['आकार', 'जुड़ी अंजलि-सा फलक'], ['तेज', 'इन्द्र के वज्र और यम के दण्ड-सा'], ['चलाया', 'अर्जुन — इस युद्ध का अंतिम बाण']]), L: [
    ['A', 'यदि मैंने तप किया है, गुरुजनों को प्रसन्न किया है,'],
    ['A', 'तो उस सत्य के बल पर — यह बाण मेरे शत्रु का वध करे!'],
  ] },
  { ch: 8, type: 'anjalikaFlight', mus: 'silence', min: 6 },
  { ch: 8, type: 'bust', who: 'K', mood: 'sun', mus: 'silence', min: 4.4, lead: 1.0, L: [['K', 'पिता... सूर्यदेव...', 2.6]] },
  { ch: 8, type: 'impact', mus: 'sorrow', flashIn: 1.4, min: 8, lead: 3.0, L: [['N', 'अंजलिकास्त्र ने कर्ण का शीश काट दिया। महारथी कर्ण रणभूमि पर गिर पड़ा।']] },
  // १० सूर्य में विलीन
  { ch: 9, type: 'ascension', mus: 'sorrow', lead: 2.2, min: 24, L: [
    ['N', 'कर्ण के शरीर से एक दिव्य तेज निकला, और आकाश को चीरता हुआ सूर्य में समा गया।'],
    ['N', 'सूर्यपुत्र अपने पिता के पास लौट गया।'], 0.6,
    ['N', 'उस दिन अर्जुन जीते। धर्म जीता।'],
    ['N', 'पर इतिहास आज भी उस दानवीर को नमन करता है — कर्ण।'],
  ] },
  { ch: 9, type: 'end', mus: 'end', min: 8, fadeIn: 1.5 },
  { ch: 9, type: 'credits', mus: 'end', min: 26, fadeOut: 3 },
];

const lineDur = (s) => clamp(1.5 + s.length * 0.07, 2.5, 8.8);

function buildTimeline() {
  let T = 0, lastCh = -1;
  const shots = [], cues = [], caps = [], chapters = [];
  for (const src of SCRIPT) {
    const s = Object.assign({}, src);
    s.start = T; s.index = shots.length;
    if (s.ch !== lastCh) { chapters.push({ n: s.ch, t: T, title: CHAPTERS[s.ch] }); lastCh = s.ch; }
    let cur = s.lead ?? 0.7;
    s.cues = [];
    for (const l of s.L || []) {
      if (typeof l === 'number') { cur += l; continue; }
      const d = l[2] ?? lineDur(l[1]);
      const cue = { t: T + cur, d, who: l[0], text: l[1], lt: cur };
      cues.push(cue); s.cues.push(cue);
      cur += d + 0.45;
    }
    s.dur = Math.max(s.min ?? 0, cur + (s.tail ?? 0.35));
    for (const cp of s.caps || []) caps.push({ t: T + cp[0], d: cp[2] ?? 3.5, text: cp[1] });
    shots.push(s); T += s.dur;
  }
  return { shots, cues, caps, chapters, dur: T };
}
