# Переводы вручную написанных разборов: slug → (английский, испанский). Генерирует src/content/builds-i18n/{en,es}/<slug>.md
import pathlib
B = {
'aino': (
"**In short:** a 4★ Hydro support who fills the Hydro slot in Lunar-Crystallize and Lunar-Charged — an accessible alternative to Columbina.",
"**En resumen:** apoyo Hydro 4★ que cubre el hueco Hydro en Cristalización Lunar y Electrocargado Lunar; una alternativa accesible a Columbina."),
'alyosha': (
"**In short:** a 7.0 Electro support who works in both of Odette's Stellar teams. Sources recommend building him fully into ATK and Energy Recharge.",
"**En resumen:** apoyo Electro de la 7.0 que funciona en los dos equipos Estelares de Odette. Las fuentes recomiendan construirlo por completo con ATQ y Recarga de Energía."),
'bennett': (
"A classic support build: Bennett's value is the ATK buff from his burst, which depends on his weapon's base ATK — hence 5★ swords with high base ATK. Stats go into Energy Recharge and HP for healing. genshin.gg suggests a damage variant with a Pyro goblet and crit, but for a support role we recommend this one.",
"Build de apoyo clásica: el valor de Bennett está en el bono de ATQ de su definitiva, que depende del ATQ base del arma; por eso espadas 5★ con ATQ base alto. Las estadísticas van a Recarga de Energía y Vida para curar. genshin.gg propone una variante de daño con cáliz Pyro y CRIT, pero para el rol de apoyo recomendamos esta."),
'columbina': (
"""**In short:** she boosts the whole team's Lunar reaction damage, so she only shines next to Moonsign characters: Ineffa, Lauma, Zibai, Nefer.

**Stats:** her bonuses cap at around **35,000 HP** — build HP first, then Energy Recharge up to ~160% (with an ER weapon) or ~180% (with anything else), and put the rest into crit at a 1:2 ratio.

**Talents:** most of her damage comes from her skill, with the burst right behind it (it gives the team a Lunar DMG bonus).""",
"""**En resumen:** potencia el daño de las reacciones Lunares de todo el equipo, así que solo brilla junto a personajes de Presagio lunar: Ineffa, Lauma, Zibai y Nefer.

**Estadísticas:** sus bonos llegan al tope en torno a **35 000 de Vida**: primero Vida, luego Recarga de Energía hasta ~160% (con arma de Recarga) o ~180% (con cualquier otra), y el resto a CRIT en proporción 1:2.

**Talentos:** la mayor parte del daño viene de la habilidad, seguida muy de cerca por la definitiva (da al equipo un bono de daño Lunar)."""),
'cyno': (
"""**In short:** in his burst form, Normal Attacks become Electro and scale off ATK and EM. The goal of the rotation is to stay in that form as long as possible.

**Stats:** sources disagree on substat priority; for Aggravate, crit ranks above EM, and Energy Recharge should reach ~130–140% so the burst is ready every rotation.

**In endgame right now:** an opening character in this season's Theater.""",
"""**En resumen:** en su forma de definitiva, los Ataques Normales pasan a ser Electro y escalan con ATQ y Maestría Elemental. El objetivo de la rotación es mantener esa forma el máximo tiempo posible.

**Estadísticas:** las fuentes no coinciden en el orden de secundarias; para Intensificación el CRIT va por encima de la Maestría, y la Recarga de Energía debe llegar a ~130–140% para tener la definitiva en cada rotación.

**En el endgame ahora:** personaje inicial del Teatro de esta temporada."""),
'flins': (
"""**In short:** an Electro DPS whose damage comes through the Lunar-Charged reaction, so the team needs a Hydro partner (Columbina or Aino) and a second Moonsign Electro character — Ineffa.

**Stats:** sources agree on an ATK goblet rather than Electro DMG — the damage comes through the reaction. Energy Recharge is the top substat: without the burst the rotation falls apart.

**In endgame right now:** the main pick for the second half of Abyss Floor 12 (Lunar-Charged buff +75%).""",
"""**En resumen:** DPS Electro cuyo daño llega a través de la reacción Electrocargado Lunar, así que el equipo necesita un compañero Hydro (Columbina o Aino) y un segundo personaje Electro de Presagio lunar: Ineffa.

**Estadísticas:** las fuentes coinciden en un cáliz de ATQ en lugar de daño Electro, porque el daño viene de la reacción. La Recarga de Energía es la primera secundaria: sin la definitiva la rotación se desmorona.

**En el endgame ahora:** la opción principal para la segunda mitad del piso 12 del Abismo (bono de Electrocargado Lunar +75%)."""),
'furina': (
"Furina's damage and healing scale with HP, so HP% on the sands. The goblet is HP% or Hydro DMG if you already have plenty of HP. Her main set is Golden Troupe.",
"El daño y la curación de Furina escalan con la Vida, así que Vida % en el reloj. El cáliz, Vida % o daño Hydro si ya tienes mucha Vida. Su conjunto principal es Compañía Dorada."),
'illuga': (
"**In short:** a Geo support built fully into Elemental Mastery. Great in Zibai teams.",
"**En resumen:** apoyo Geo que se construye por completo con Maestría Elemental. Muy bueno en equipos de Zibai."),
'ineffa': (
"""**In short:** off-field Electro damage that enables Lunar-Charged in any team with Hydro. One of the most flexible Moonsign supports.

**Stats:** like Flins, an ATK goblet. Unlike him, crit matters more than energy.""",
"""**En resumen:** daño Electro fuera de campo que activa Electrocargado Lunar en cualquier equipo con Hydro. Uno de los apoyos de Presagio lunar más versátiles.

**Estadísticas:** como Flins, cáliz de ATQ. A diferencia de él, el CRIT importa más que la energía."""),
'kaveh': (
"""**In short:** during his burst, Kaveh's Normal Attacks burst Dendro Cores themselves, so he works as the on-field character in Nilou teams.

**In endgame right now:** an opening character in this season's Theater.""",
"""**En resumen:** durante su definitiva, los Ataques Normales de Kaveh hacen estallar los Núcleos Dendro, así que funciona como personaje en campo en los equipos de Nilou.

**En el endgame ahora:** personaje inicial del Teatro de esta temporada."""),
'kuki-shinobu': (
"""**In short:** a Hyperbloom Electro trigger plus healing from a single skill — one of the most underrated 4★s. All her damage comes from Elemental Mastery, so EM in all three slots.

**In endgame right now:** an opening character in this season's Theater — boosted by +20% HP, ATK and DEF.""",
"""**En resumen:** activadora Electro de Hyperbloom y curación con una sola habilidad; una de las 4★ más infravaloradas. Todo su daño viene de la Maestría Elemental, así que Maestría en las tres piezas.

**En el endgame ahora:** personaje inicial del Teatro de esta temporada, con +20% de Vida, ATQ y DEF."""),
'lauma': (
"""**In short:** a Dendro support who works both in the new Lunar-Bloom (with Nefer) and in classic Nilou Bloom.

**Stats:** all her damage and buffs come from Elemental Mastery; she doesn't need crit. Secure energy first, then EM.""",
"""**En resumen:** apoyo Dendro que funciona tanto en el nuevo Florecimiento Lunar (con Nefer) como en el Florecimiento clásico de Nilou.

**Estadísticas:** todo su daño y sus bonos vienen de la Maestría Elemental; no necesita CRIT. Primero asegura la energía y después la Maestría."""),
'linnea': (
"**In short:** a Moonsign Geo support; Zibai's main partner, but she also fits Lunar-Bloom.",
"**En resumen:** apoyo Geo de Presagio lunar; la compañera principal de Zibai, aunque también encaja en Florecimiento Lunar."),
'nefer': (
"""**In short:** a Dendro DPS whose damage comes through Lunar-Bloom (Dendro + Hydro). The team core is Lauma and Columbina.

**Stats:** EM on sands and goblet, crit on the circlet. In this season's Theater (Hydro / Electro / Dendro) it's one of the strongest lineups.""",
"""**En resumen:** DPS Dendro cuyo daño llega a través del Florecimiento Lunar (Dendro + Hydro). El núcleo del equipo son Lauma y Columbina.

**Estadísticas:** Maestría Elemental en reloj y cáliz, CRIT en la tiara. En el Teatro de esta temporada (Hydro / Electro / Dendro) es una de las formaciones más fuertes."""),
'nicole': (
"**In short:** a Pyro support you bring for team buffs rather than her own damage: build ATK and energy, with crit as an afterthought.",
"**En resumen:** apoyo Pyro que se lleva por sus bonos al equipo y no por su daño: build de ATQ y energía, con el CRIT en segundo plano."),
'odette': (
"""**In short:** the new 7.0 Cryo character both Stellar reactions are built around — Stellar-Conduct (with Electro) and Stellar Swirl (with Anemo).

**In endgame right now:** in almost every recommended team for the first half of Abyss Floor 12; a special guest in the Theater.""",
"""**En resumen:** la nueva personaje Cryo de la 7.0 alrededor de la que se construyen las dos reacciones Estelares: Superconductor Estelar (con Electro) y Torbellino Estelar (con Anemo).

**En el endgame ahora:** está en casi todos los equipos recomendados para la primera mitad del piso 12 del Abismo; en el Teatro es invitada especial."""),
'ororon': (
"**In short:** an Electro support with off-field damage; in Natlan he's Chasca's best partner, and now he also fills the fourth slot in Lunar-Charged teams.",
"**En resumen:** apoyo Electro con daño fuera de campo; en Natlan es el mejor compañero de Chasca, y ahora también ocupa el cuarto hueco en equipos de Electrocargado Lunar."),
'qiqi': (
"**In short:** her healing scales with ATK, so build ATK%. She's suddenly back in the meta: she fills the Cryo healer slot in Stellar-Conduct teams.",
"**En resumen:** su curación escala con ATQ, así que build de ATQ %. Ha vuelto de repente al meta: cubre el hueco de sanadora Cryo en los equipos de Superconductor Estelar."),
'raiden-shogun': (
"""**In short:** nearly all of her damage is in her Elemental Burst. Her skill places an eye that builds Resolve as allies spend energy, so the party bursts first and Raiden bursts last.

**Rotation (National):** Raiden E → Xingqiu E Q → Bennett Q E → Xiangling Q E → Raiden Q → Normal Attack combo.""",
"""**En resumen:** casi todo su daño está en la Habilidad Definitiva. Su habilidad coloca un ojo que acumula Resolución cuando los aliados gastan energía, así que primero lanzan su definitiva los compañeros y al final Raiden.

**Rotación (National):** Raiden E → Xingqiu E Q → Bennett Q E → Xiangling Q E → Raiden Q → combo de Ataques Normales."""),
'sandrone': (
"""**In short:** a Cryo DPS for the new Stellar-Conduct reaction (Cryo + Electro). The team core is Odette plus Electro partners Yae Miko and Alyosha.

**In endgame right now:** recommended for the first half of Abyss Floor 12 as an alternative to Stellar Swirl; a special guest in this season's Theater.""",
"""**En resumen:** DPS Cryo para la nueva reacción Superconductor Estelar (Cryo + Electro). El núcleo del equipo es Odette con los compañeros Electro Yae Miko y Aliosha.

**En el endgame ahora:** recomendada para la primera mitad del piso 12 del Abismo como alternativa al Torbellino Estelar; invitada especial en el Teatro de esta temporada."""),
'sucrose': (
"""**In short:** a timeless 4★ support: she shreds RES through Viridescent Venerer, shares Elemental Mastery with the team and groups enemies.

**In endgame right now:** a Theater special guest and part of teams for both halves of Abyss 7.0.""",
"""**En resumen:** apoyo 4★ atemporal: reduce la RES con Sombra Verde Esmeralda, comparte Maestría Elemental con el equipo y agrupa a los enemigos.

**En el endgame ahora:** invitada especial del Teatro y parte de equipos para ambas mitades del Abismo 7.0."""),
'traveler-cryo': (
"**In short:** the Cryo Traveler is a Stellar reaction character whose damage scales with ATK. The set depends on the team: Stellar-Conduct — Disenchantment in Deep Shadow, Stellar Swirl — Tenacity of the Millelith.",
"**En resumen:** el Viajero Cryo es un personaje de reacciones Estelares cuyo daño escala con ATQ. El conjunto depende del equipo: Superconductor Estelar — Desilusión Congelada en las Sombras; Torbellino Estelar — Tenacidad de la Geoarmada."),
'vesna': (
"""**In short:** Vesna's whole kit is built around Stellar Swirl, so other archetypes barely suit her. Stellar Swirl scales with ATK — hence ATK on the sands and goblet.

**Partners:** Odette is the core of any Stellar team; the Cryo Traveler provides Cryo for the reaction; C6 Faruzan is one of the best Anemo buffers.

**In endgame right now:** the first half of Abyss Floor 12 boosts Swirl and Stellar Swirl — this is her content.""",
"""**En resumen:** todo el kit de Vesna gira en torno al Torbellino Estelar, así que otros arquetipos apenas le sirven. El Torbellino Estelar escala con ATQ; de ahí el ATQ en reloj y cáliz.

**Compañeros:** Odette es el núcleo de cualquier equipo Estelar; el Viajero Cryo aporta el Cryo para la reacción; Faruzan en C6 es uno de los mejores apoyos Anemo.

**En el endgame ahora:** la primera mitad del piso 12 del Abismo potencia Torbellino y Torbellino Estelar: es su contenido."""),
'vodyanitsa': (
"""**In short:** a Hydro support who needs nothing but HP: both her buffs and her own damage depend on it, so HP in all three slots. She shreds Cryo and Hydro RES, and Anemo RES too while a Stellar Vortex is active.

**Partners:** in Freeze — with Skirk, Escoffier and Furina; in Stellar Swirl — with Vesna or Mizuki.""",
"""**En resumen:** apoyo Hydro que solo necesita Vida: de ella dependen tanto sus bonos como su propio daño, así que Vida en las tres piezas. Reduce la RES Cryo e Hydro, y también la Anemo mientras hay un Vórtice Estelar activo.

**Compañeros:** en Congelación, con Skirk, Escoffier y Furina; en Torbellino Estelar, con Vesna o Mizuki."""),
'wriothesley': (
"""**In short:** a Normal Attack Cryo DPS: his skill spends HP to empower his attacks, and Marechaussee Hunter gains crit stacks from HP changes.

**In endgame right now:** an alternative to Sandrone for the first half of Floor 12 — paired with Odette through Stellar-Conduct.""",
"""**En resumen:** DPS Cryo de Ataques Normales: su habilidad gasta Vida para potenciar sus ataques y el Cazador Fantasmal acumula CRIT con los cambios de Vida.

**En el endgame ahora:** alternativa a Sandrone para la primera mitad del piso 12, junto a Odette mediante Superconductor Estelar."""),
'xingqiu': (
"""**In short:** nearly all his damage is the rain swords from his burst, which strike alongside the active character's Normal Attacks. They also grant damage reduction and interruption resistance.

**Stats:** Energy Recharge to ~200% first (less with Sacrificial Sword), then crit.

**In endgame right now:** an opening character in this season's Theater.

*We adjusted the weapon order: Sacrificial Sword and Favonius are the standard for Xingqiu; 5★ swords add more damage, but he doesn't need them as much.*""",
"""**En resumen:** casi todo su daño son las espadas de lluvia de su definitiva, que atacan junto con los Ataques Normales del personaje activo. Además dan reducción de daño y resistencia a la interrupción.

**Estadísticas:** primero Recarga de Energía hasta ~200% (menos con Espada de Sacrificio), luego CRIT.

**En el endgame ahora:** personaje inicial del Teatro de esta temporada.

*Hemos corregido el orden de armas: Espada de Sacrificio y Espada de Favonius son lo estándar para Xingqiu; las espadas 5★ aportan más daño, pero no las necesita tanto.*"""),
'yae-miko': (
"""**In short:** her three skill totems deal steady off-field Electro damage, and almost all her damage comes from the skill. She fits well into the new Stellar-Conduct teams.

**Rotation:** skill ×3 → burst (turns the totems into powerful strikes) → skill ×3 again.""",
"""**En resumen:** sus tres tótems de habilidad hacen daño Electro constante fuera de campo, y casi todo su daño viene de la habilidad. Encaja bien en los nuevos equipos de Superconductor Estelar.

**Rotación:** habilidad ×3 → definitiva (convierte los tótems en golpes potentes) → habilidad ×3 de nuevo."""),
'yelan': (
"Yelan's damage scales with HP, so HP% on the sands if your energy is sufficient; otherwise Energy Recharge. We adjusted the weapon order: Aqua Simulacra is her signature.",
"El daño de Yelan escala con la Vida, así que Vida % en el reloj si te llega la energía; si no, Recarga de Energía. Hemos corregido el orden de armas: Aqua Simulacra es su arma exclusiva."),
'yumemizuki-mizuki': (
"""**In short:** an Anemo DPS whose damage comes through Swirl and, since 7.0, Stellar Swirl paired with Odette.

**In endgame right now:** the first half of Abyss Floor 12 is made for her: +200% Swirl DMG, +75% Stellar Swirl DMG, and the Abyss blessing adds True DMG on every Swirl.""",
"""**En resumen:** DPS Anemo cuyo daño llega a través del Torbellino y, desde la 7.0, del Torbellino Estelar junto a Odette.

**En el endgame ahora:** la primera mitad del piso 12 del Abismo está hecha para ella: +200% de daño de Torbellino, +75% de Torbellino Estelar, y la bendición del Abismo añade daño verdadero con cada Torbellino."""),
'zibai': (
"""**In short:** a Geo DPS whose damage scales entirely with DEF and comes through Lunar-Crystallize (Geo + Hydro). To power her up you need Moonsign characters: Columbina, Illuga or Aino.

**Stats:** DEF on sands and goblet, crit on the circlet. EM in substats helps too — it boosts Lunar-Crystallize.""",
"""**En resumen:** DPS Geo cuyo daño escala por completo con la DEF y llega a través de la Cristalización Lunar (Geo + Hydro). Para potenciarla necesitas personajes de Presagio lunar: Columbina, Illuga o Aino.

**Estadísticas:** DEF en reloj y cáliz, CRIT en la tiara. La Maestría Elemental en secundarias también ayuda: potencia la Cristalización Lunar."""),
}
root = pathlib.Path(__file__).parent.parent.parent / 'src/content/builds-i18n'
for lang_i, lang in enumerate(['en', 'es']):
    d = root / lang
    d.mkdir(parents=True, exist_ok=True)
    for slug, texts in B.items():
        (d / f'{slug}.md').write_text('---\n---\n\n' + texts[lang_i].strip() + '\n', encoding='utf-8')
print('разборов:', len(B), '× 2 языка')
