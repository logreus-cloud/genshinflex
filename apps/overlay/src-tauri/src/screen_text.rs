use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Screen { Wishes, Character(String) }

#[derive(Default)]
pub struct Names { by_name: HashMap<String, Vec<String>> }

#[derive(Deserialize)]
struct NameFile { v: u8, characters: Vec<NameEntry> }
#[derive(Deserialize)]
struct NameEntry { s: String, n: Vec<String> }

impl Names {
    pub fn from_json(raw: &str) -> Option<Self> {
        let file: NameFile = serde_json::from_str(raw).ok()?;
        if file.v != 1 { return None; }
        let mut names = Self::default();
        for entry in file.characters {
            if entry.s.starts_with("traveler") { continue; }
            for name in entry.n {
                let key = compact(&name);
                if !key.is_empty() {
                    let slugs = names.by_name.entry(key).or_default();
                    if !slugs.contains(&entry.s) { slugs.push(entry.s.clone()); }
                }
            }
        }
        Some(names)
    }
}

fn normalize(raw: &str) -> String {
    raw.to_lowercase().replace('ё', "е").chars()
        .map(|ch| if ch.is_alphabetic() || ch == ' ' { ch } else { ' ' })
        .collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn compact(raw: &str) -> String { normalize(raw).replace(' ', "") }

fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, left) in a.chars().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, right) in b.iter().enumerate() {
            let old = row[j + 1];
            row[j + 1] = (row[j + 1] + 1).min(row[j] + 1).min(previous + usize::from(left != *right));
            previous = old;
        }
    }
    row[b.len()]
}

const ELEMENTS: [&str; 14] = ["пиро", "гидро", "анемо", "электро", "дендро", "крио", "гео",
    "pyro", "hydro", "anemo", "electro", "dendro", "cryo", "geo"];

pub fn classify(lines: &[String], names: &Names) -> Option<Screen> {
    for line in lines {
        let clean = normalize(line);
        let mut words: Vec<&str> = clean.split_whitespace().collect();
        while words.last().is_some_and(|word| word.chars().count() == 1) { words.pop(); }
        if words.len() <= 2 && words.first().is_some_and(|word|
            ["молитв", "wish", "gachap"].iter().any(|prefix| word.starts_with(prefix))) {
            return Some(Screen::Wishes);
        }
        let tokens: Vec<String> = line.split(|ch: char| ch.is_whitespace() || "/|\\".contains(ch))
            .map(compact).filter(|token| !token.is_empty() && token != "i" && token != "l" && token != "1").collect();
        let Some(element) = tokens.first() else { continue };
        if !ELEMENTS.iter().any(|known| distance(element, known) <= 1) { continue; }
        let mut tail = tokens[1..].to_vec();
        while tail.last().is_some_and(|token| token.chars().count() == 1) { tail.pop(); }
        let query = tail.join("");
        if query.is_empty() { continue; }
        let mut best = usize::MAX;
        let mut slug = None;
        let mut tied = false;
        for (name, slugs) in &names.by_name {
            let d = distance(&query, name);
            let len = query.chars().count().min(name.chars().count());
            if d > if len >= 8 { 2 } else if len >= 4 { 1 } else { 0 } { continue; }
            for candidate in slugs {
                if d < best {
                    best = d;
                    slug = Some(candidate);
                    tied = false;
                } else if d == best && slug != Some(candidate) {
                    tied = true;
                }
            }
        }
        if !tied {
            if let Some(slug) = slug { return Some(Screen::Character(slug.clone())); }
        }
    }
    None
}

#[derive(Default)]
pub struct Debounce { pending: Option<Screen>, count: u8, applied: Option<Screen> }

impl Debounce {
    pub fn push(&mut self, value: Option<Screen>) -> Option<Screen> {
        if value == self.pending { self.count = self.count.saturating_add(1); }
        else { self.pending = value.clone(); self.count = 1; }
        if self.count < 2 { return None; }
        if value.is_none() { self.applied = None; return None; }
        if value != self.applied { return value; }
        None
    }

    pub fn mark_applied(&mut self, screen: Screen) { self.applied = Some(screen); }
}

#[cfg(test)]
pub(crate) const SAMPLE_NAMES: &str = r#"{"v":1,"characters":[{"s":"vesna","n":["Весна","Vesna"]},{"s":"eula","n":["Эола","Eula"]},{"s":"fischl","n":["Фишль","Fischl"]},{"s":"hu-tao","n":["Ху Тао","Hu Tao"]},{"s":"kachina","n":["Качина","Kachina"]},{"s":"tighnari","n":["Тигнари","Tighnari"]},{"s":"vodyanitsa","n":["Водяница","Vodyanitsa"]},{"s":"varesa","n":["Вареса","Varesa"]},{"s":"traveler-anemo","n":["Путешественник","Traveler"]}]}"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_titles() {
        let names = Names::from_json(SAMPLE_NAMES).unwrap();
        for title in ["Wish", "Молитва", "Молитв", "Молитвае", "Молитв&.,", "Молитва>-",
            "Молитва \"", "Молитва +", "Молитва..-"] {
            assert_eq!(classify(&[title.into()], &names), Some(Screen::Wishes), "{title}");
        }
        for (title, slug) in [
            ("Cryo I Eula", "eula"), ("Electro / Fischl", "fischl"),
            ("Pyro I Hu Tao", "hu-tao"), ("pyro I Hu Tao", "hu-tao"),
            ("Geo I Kachina", "kachina"), ("Dendro I Tighnari", "tighnari"),
            ("Dendro / Tighnari", "tighnari"), ("Anemo / Vesna", "vesna"),
            ("'Anemo I Vesna", "vesna"), ("Hydro / Vodyanitsa", "vodyanitsa"),
            ("Анемо I Весна", "vesna"), ("Анемо I Весна -", "vesna"),
            ("Анемо I Верна", "vesna"), ("Электро I Вареса", "varesa"),
            ("Гидро I Водяница", "vodyanitsa"), ("Гео I Качина", "kachina"),
            ("Гео/ Качина", "kachina"), ("Вендро I Тигнари", "tighnari"),
            ("Пиро I Ху Тао", "hu-tao"), ("Крио I Эола", "eula"),
            ("Крио / Эола", "eula"),
        ] {
            assert_eq!(classify(&[title.into()], &names), Some(Screen::Character(slug.into())), "{title}");
        }
        for title in ["", " ", "Персонажи", "Paimon Menu", "Анемо", "Q",
            "Inventory / Weapons", "Анемо / Путешественник", "Anemo / Traveler"] {
            assert_eq!(classify(&[title.into()], &names), None, "{title}");
        }
        assert_eq!(classify(&[], &names), None);
        assert_eq!(classify(&["Анемо I Весна".into()], &Names::default()), None);
    }

    #[test]
    fn debounce_reopens_same_screen() {
        let mut debounce = Debounce::default();
        let vesna = Screen::Character("vesna".into());
        assert_eq!(debounce.push(Some(vesna.clone())), None);
        assert_eq!(debounce.push(Some(vesna.clone())), Some(vesna.clone()));
        assert_eq!(debounce.push(Some(vesna.clone())), Some(vesna.clone()));
        debounce.mark_applied(vesna.clone());
        assert_eq!(debounce.push(Some(vesna.clone())), None);
        assert_eq!(debounce.push(None), None);
        assert_eq!(debounce.push(Some(vesna.clone())), None);
        assert_eq!(debounce.push(Some(vesna.clone())), None);
        assert_eq!(debounce.push(None), None);
        assert_eq!(debounce.push(None), None);
        assert_eq!(debounce.push(Some(vesna.clone())), None);
        assert_eq!(debounce.push(Some(vesna.clone())), Some(vesna));
        assert_eq!(debounce.push(Some(Screen::Wishes)), None);
        assert_eq!(debounce.push(Some(Screen::Wishes)), Some(Screen::Wishes));
    }
}
