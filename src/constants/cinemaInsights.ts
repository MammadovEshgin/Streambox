import type { AppLanguage } from "../localization/types";

type CinemaInsight = {
  en: string;
  tr: string;
};

const CINEMA_INSIGHTS: CinemaInsight[] = [
  {
    en: "A strong opening scene does two jobs at once: it creates a mood and quietly teaches the audience how to watch the story.",
    tr: "Güçlü bir açılış sahnesi aynı anda iki iş yapar: bir atmosfer kurar ve seyirciye hikâyeyi nasıl izlemesi gerektiğini sessizce öğretir.",
  },
  {
    en: "Screenwriters often call the moment that upsets the hero's normal life the inciting incident; if it arrives too late, the story can feel flat.",
    tr: "Senaryo yazımında kahramanın düzenli hayatını bozan ana kırılmaya tetikleyici olay denir; bu an geç gelirse hikâye sönük hissedilebilir.",
  },
  {
    en: "Subtext is what a character means but does not say. Many great scenes become memorable because the dialogue and the emotion are slightly different.",
    tr: "Alt metin, karakterin söylemediği ama hissettirdiği şeydir. Birçok güçlü sahne, diyalog ile duygunun tam olarak aynı olmaması sayesinde akılda kalır.",
  },
  {
    en: "Blocking is the choreography of actors in space. Good blocking can reveal power, intimacy, distance, or conflict before anyone speaks.",
    tr: "Bloklama, oyuncuların mekân içindeki koreografisidir. İyi bir bloklama, daha kimse konuşmadan güç, yakınlık, mesafe ya da çatışmayı gösterebilir.",
  },
  {
    en: "A master shot covers the whole scene geography. Editors rely on it when close shots do not connect smoothly.",
    tr: "Master plan, sahnenin tüm coğrafyasını kapsar. Yakın planlar birbirine düzgün bağlanmadığında kurgu çoğu zaman bu çekime dayanır.",
  },
  {
    en: "Coverage means filming a scene from enough angles and sizes to give the editor choices later. Better coverage usually means better rhythm in the edit.",
    tr: "Coverage, bir sahneyi kurgucunun sonradan seçim yapabileceği kadar farklı açı ve ölçekte çekmektir. Güçlü coverage genelde daha iyi kurgu ritmi demektir.",
  },
  {
    en: "The 180-degree rule protects screen direction. Crossing the line can confuse viewers unless the change is clearly motivated.",
    tr: "180 derece kuralı bakış ve hareket yönünü korur. Bu çizgi sebepsizce geçilirse seyirci mekânsal olarak kolayca şaşırabilir.",
  },
  {
    en: "The 30-degree rule exists to keep angle changes meaningful. If the camera barely moves between two shots, the cut can feel like a mistake.",
    tr: "30 derece kuralı açı değişimini anlamlı kılmak için vardır. Kamera iki çekim arasında çok az yer değiştirirse kesme hata gibi hissedilebilir.",
  },
  {
    en: "A wide shot explains space, a medium shot explains relationships, and a close-up explains emotion.",
    tr: "Geniş plan mekânı anlatır, orta plan ilişkileri anlatır, yakın plan ise duyguyu anlatır.",
  },
  {
    en: "Long lenses compress distance and make backgrounds feel closer. Wide lenses exaggerate depth and can make movement feel more aggressive.",
    tr: "Uzun odaklı lensler mesafeyi sıkıştırır ve arka planı daha yakın hissettirir. Geniş açılar ise derinliği büyütür ve hareketi daha sert hissettirebilir.",
  },
  {
    en: "Depth of field is not only a beauty choice. It directs attention by deciding what must stay sharp and what should disappear.",
    tr: "Alan derinliği sadece estetik bir tercih değildir. Neye netlik verileceğini belirleyerek dikkati yönetir.",
  },
  {
    en: "Anamorphic lenses create a wider image and distinctive optical character. Many filmmakers use them when they want scale to feel emotional, not just large.",
    tr: "Anamorfik lensler daha geniş bir görüntü ve belirgin bir optik karakter üretir. Pek çok yönetmen, ölçeğin sadece büyük değil duygusal da hissedilmesini istediğinde bu lensleri tercih eder.",
  },
  {
    en: "Key light defines the main shape of a face. Fill light controls contrast, and backlight helps separate the subject from the background.",
    tr: "Ana ışık yüzün temel şeklini kurar. Dolgu ışığı kontrastı kontrol eder, arka ışık ise özneyi fondan ayırır.",
  },
  {
    en: "Low-key lighting uses deeper shadows and higher contrast. It is often chosen when tension, ambiguity, or danger should dominate the frame.",
    tr: "Düşük anahtarlı ışık, derin gölgeler ve daha yüksek kontrast kullanır. Gerilim, belirsizlik ya da tehlike hissi baskın olmalıysa sıkça tercih edilir.",
  },
  {
    en: "High-key lighting reduces heavy shadows and keeps the image more open. Comedy, musicals, and many commercial films use it to feel inviting.",
    tr: "Yüksek anahtarlı ışık ağır gölgeleri azaltır ve görüntüyü daha açık tutar. Komedi, müzikal ve birçok ticari film daha davetkâr görünmek için bunu kullanır.",
  },
  {
    en: "Motivated lighting works best when every light source seems to come from the world of the scene, even if the setup is highly controlled.",
    tr: "Motivasyonlu ışık, kurulum ne kadar kontrollü olursa olsun ışığın sahnenin dünyasından geliyormuş gibi görünmesiyle güç kazanır.",
  },
  {
    en: "Practical lights are fixtures visible inside the frame, such as lamps, signs, or bulbs. They often justify the rest of the lighting design.",
    tr: "Pratik ışıklar, kadraj içinde görünen lamba, tabela ya da ampul gibi kaynaklardır. Çoğu zaman diğer ışık düzeninin gerekçesini bunlar oluşturur.",
  },
  {
    en: "Warm and cool color temperatures shape emotion before the audience can explain why. Color often works faster than dialogue.",
    tr: "Sıcak ve soğuk renk sıcaklıkları, seyirci nedenini açıklayamadan duyguyu şekillendirir. Renk çoğu zaman diyalogdan daha hızlı çalışır.",
  },
  {
    en: "Production design is storytelling with surfaces. The age, wear, color, and arrangement of objects all suggest a life beyond the frame.",
    tr: "Sanat yönetimi, yüzeyler üzerinden hikâye anlatmaktır. Nesnelerin yaşı, yıpranması, rengi ve yerleşimi kadrajın ötesinde bir hayat hissettirir.",
  },
  {
    en: "Costume design is not just about period accuracy or style. It also tracks the emotional evolution of a character scene by scene.",
    tr: "Kostüm tasarımı sadece dönem doğruluğu ya da stil değildir. Aynı zamanda karakterin duygusal dönüşümünü sahne sahne takip eder.",
  },
  {
    en: "Negative space can make a character feel isolated, vulnerable, or watched. Empty space is often as expressive as the actor.",
    tr: "Negatif alan, bir karakteri yalnız, kırılgan ya da izleniyormuş gibi hissettirebilir. Boşluk çoğu zaman oyuncu kadar ifade taşır.",
  },
  {
    en: "Leading lines help the eye travel through a frame. Great cinematography often hides this guidance so it feels natural rather than forced.",
    tr: "Yönlendiren çizgiler gözü kadraj içinde taşır. İyi görüntü yönetimi bu yönlendirmeyi çoğu zaman doğal hissettirecek kadar görünmez kılar.",
  },
  {
    en: "A reaction shot can be more important than the line that caused it. Cinema often lives in the face that receives the event, not the event itself.",
    tr: "Tepki planı, ona yol açan replikten daha önemli olabilir. Sinema çoğu zaman olayın kendisinde değil, onu karşılayan yüzde yaşar.",
  },
  {
    en: "Point-of-view shots work best when the audience clearly understands whose perception they are borrowing and why it matters.",
    tr: "Bakış açısı planları, seyircinin kimin algısını ödünç aldığını ve bunun neden önemli olduğunu açıkça hissettiğinde daha iyi çalışır.",
  },
  {
    en: "Montage compresses time by selecting only the pieces that matter. The emotional meaning comes from the order of shots, not the shots alone.",
    tr: "Montaj, yalnızca gerekli parçaları seçerek zamanı sıkıştırır. Duygusal anlam tek tek planlardan değil, onların sıralanışından doğar.",
  },
  {
    en: "A match cut links two shots through shape, motion, or meaning. When it works, the audience feels continuity and surprise at the same time.",
    tr: "Eşleşme kesmesi, iki planı biçim, hareket ya da anlam üzerinden bağlar. İyi çalıştığında seyirci aynı anda hem süreklilik hem de şaşkınlık hisseder.",
  },
  {
    en: "J-cuts and L-cuts let sound cross the edit point. They make scenes feel smoother because the ear is prepared before the eye catches up.",
    tr: "J-cut ve L-cut, sesin kesme noktasını aşmasına izin verir. Kulak gözü önceden hazırladığı için sahneler daha akıcı hissedilir.",
  },
  {
    en: "Elliptical editing deliberately removes expected moments. This can make a film feel more intelligent because the audience completes the missing steps.",
    tr: "Eliptik kurgu beklenen anları bilerek çıkarır. Böylece film daha zeki hissedilir çünkü eksik adımları seyirci tamamlar.",
  },
  {
    en: "Pacing is not the same as speed. A slow film can feel gripping if the dramatic tension keeps evolving.",
    tr: "Tempo, hız ile aynı şey değildir. Dramatik gerilim sürekli dönüşüyorsa yavaş bir film bile son derece sürükleyici olabilir.",
  },
  {
    en: "Shot duration changes how a performance is read. Holding longer can create truth, while cutting faster can create energy or anxiety.",
    tr: "Plan süresi, oyunculuğun nasıl algılandığını değiştirir. Uzun tutmak hakikati güçlendirebilir, hızlı kesmek ise enerji ya da kaygı yaratabilir.",
  },
  {
    en: "Room tone is the invisible glue of sound editing. Without it, dialogue edits often feel sharp or artificial.",
    tr: "Ortam tonu, ses kurgusunun görünmez yapıştırıcısıdır. O olmadan diyalog kesmeleri çoğu zaman sert ya da yapay duyulur.",
  },
  {
    en: "Foley is the craft of performing everyday sounds for the screen. Footsteps, fabric, and object touches often become believable only after foley work.",
    tr: "Foley, gündelik sesleri ekran için yeniden üretme sanatıdır. Adımlar, kumaş sesleri ve nesne temasları çoğu zaman ancak foley ile inandırıcı olur.",
  },
  {
    en: "ADR replaces or repairs dialogue after shooting. Good ADR is not only about clean words, but about matching breath, rhythm, and emotional pressure.",
    tr: "ADR, çekimden sonra diyalogu yenileme ya da onarma işlemidir. İyi ADR sadece temiz kelimeler değil, nefes, ritim ve duygusal baskının da eşleşmesidir.",
  },
  {
    en: "Diegetic sound belongs to the world of the scene, like a radio or footsteps. Non-diegetic sound, like score, speaks directly to the audience.",
    tr: "Diegetik ses sahnenin dünyasına aittir; radyo ya da ayak sesi gibi. Diegetik olmayan ses, örneğin müzik, doğrudan seyirciye konuşur.",
  },
  {
    en: "A sound bridge can carry emotion across scenes even when the image changes sharply. Editors use it to keep narrative flow alive.",
    tr: "Ses köprüsü, görüntü sert biçimde değişse bile duyguyu sahneler arasında taşıyabilir. Kurgucular akışı canlı tutmak için bunu kullanır.",
  },
  {
    en: "Silence is one of cinema's most precise tools. Used at the right moment, it can feel louder than music.",
    tr: "Sessizlik, sinemanın en hassas araçlarından biridir. Doğru anda kullanıldığında müzikten daha gür hissedilebilir.",
  },
  {
    en: "A leitmotif is a recurring musical idea tied to a person, place, or emotion. Repetition turns sound into memory.",
    tr: "Leitmotif, bir kişi, mekân ya da duyguya bağlanan tekrar eden müzikal fikirdir. Tekrar, sesi hafızaya dönüştürür.",
  },
  {
    en: "Great dialogue rarely explains everything. It creates friction between what is said, what is meant, and what is avoided.",
    tr: "Güçlü diyalog çoğu zaman her şeyi açıklamaz. Söylenen, kastedilen ve özellikle kaçınılan şey arasında bir gerilim kurar.",
  },
  {
    en: "A scene becomes dramatic when someone wants something now and something stands in the way. Without that pressure, scenes often drift.",
    tr: "Bir sahne, biri bir şeyi şimdi istediğinde ve önünde engel olduğunda dramatikleşir. Bu baskı yoksa sahneler kolayca dağılır.",
  },
  {
    en: "Stakes do not have to be global to feel big. If the audience understands why the loss matters to the character, the scene already has weight.",
    tr: "Duygusal ağırlık yaratmak için risklerin dünyayı etkilemesi gerekmez. Seyirci kaybın karakter için neden önemli olduğunu anlarsa sahne zaten değer kazanır.",
  },
  {
    en: "A midpoint often changes the direction of a story. It is the moment when new information forces the hero to play a different game.",
    tr: "Orta nokta, hikâyenin yönünü değiştiren andır. Yeni bilgi kahramanı artık başka bir oyun oynamaya zorlar.",
  },
  {
    en: "Reversals keep scenes alive because they shift power. The person who enters a scene in control should not always leave it that way.",
    tr: "Tersine dönüşler sahneleri canlı tutar çünkü gücü yer değiştirir. Sahneye kontrolle giren kişi her zaman aynı kontrolle çıkmamalıdır.",
  },
  {
    en: "Dramatic irony appears when the audience knows more than the character. Used carefully, it creates tension without needing extra action.",
    tr: "Dramatik ironi, seyircinin karakterden daha fazlasını bildiği anda doğar. Doğru kullanıldığında ek aksiyona ihtiyaç duymadan gerilim üretir.",
  },
  {
    en: "Setup and payoff are really about trust. The film asks the audience to notice something early and rewards that attention later.",
    tr: "Kurulum ve karşılık, aslında güven meselesidir. Film seyirciden bir şeyi erken fark etmesini ister ve bu dikkati ileride ödüllendirir.",
  },
  {
    en: "Color grading does not rescue weak cinematography, but it can unify mood, time, and emotional temperature across an entire film.",
    tr: "Renk düzenleme zayıf görüntü yönetimini kurtarmaz, fakat bir filmin duygu, zaman ve atmosfer sıcaklığını bütünlüklü hâle getirebilir.",
  },
  {
    en: "Texture in lighting often comes from contrast across surfaces, not brightness alone. Smoke, rain, glass, and fabric all change how light feels.",
    tr: "Işığın dokusu çoğu zaman yalnız parlaklıktan değil, yüzeyler arasındaki kontrasttan gelir. Duman, yağmur, cam ve kumaş ışığın hissini değiştirir.",
  },
  {
    en: "A one-take shot is powerful only when form supports meaning. If the continuous take says nothing about the scene, it becomes a trick instead of language.",
    tr: "Tek plan çekim, ancak biçim anlamı destekliyorsa güçlüdür. Sürekli plan sahne hakkında bir şey söylemiyorsa dil değil numara gibi kalır.",
  },
  {
    en: "Handheld camera work feels alive when it follows emotion, not when it shakes randomly. Good handheld movement has intention and rhythm.",
    tr: "Elde kamera, rastgele sallandığında değil duyguyu takip ettiğinde canlı hissedilir. İyi elde çekimin niyeti ve ritmi vardır.",
  },
  {
    en: "Practical effects often feel convincing because actors and light interact with something real. Even small physical elements can sell a fantastic world.",
    tr: "Pratik efektler çoğu zaman daha inandırıcıdır çünkü oyuncular ve ışık gerçek bir şeyle etkileşir. Küçük fiziksel detaylar bile fantastik bir dünyayı ikna edici kılabilir.",
  },
  {
    en: "The best visual style is not decoration; it is theme made visible. When image choices echo the central idea, the film feels authored.",
    tr: "En iyi görsel stil süs değildir; temanın görünür hâlidir. Görüntü tercihleri ana fikri yankıladığında film gerçekten yönetilmiş hissedilir.",
  },
];

export function getRandomCinemaInsight(language: AppLanguage) {
  const insight = CINEMA_INSIGHTS[Math.floor(Math.random() * CINEMA_INSIGHTS.length)];
  return insight[language];
}
