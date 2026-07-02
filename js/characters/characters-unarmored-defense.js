/**
 * Curated registry of class/subclass "Unarmored Defense" features.
 *
 * Feature descriptions are free-form prose, so their AC formula can't be reliably parsed
 * from text. Instead, the Unarmored Defense variants are described here as structured
 * entries that the derived-stat engine (`CharactersCalc`) can apply.
 *
 * Each variant sets the character's *base* Armor Class (while unarmored) to
 * `10 + Dexterity modifier + <secondary ability> modifier`, optionally still allowing a
 * shield's bonus to stack on top.
 *
 * Class entries are keyed by `"className|classSource"` lowercased. Subclass entries are
 * keyed by `"className|classSource|subclassShortName|subclassSource"` lowercased. A `"*"`
 * wildcard source segment matches any source (used when the effect is identical across
 * reprints).
 *
 * Entry fields:
 *   - ability      {string}   Secondary ability key ("con"/"wis"/"cha") added to 10 + Dex.
 *   - allowShield  {boolean}  Whether a shield's AC bonus may stack on top of the base.
 *   - level        {number}   Class/subclass level at which the feature is gained.
 *   - label        {string}   Human-readable source label (for tooltips).
 */
export class CharactersUnarmoredDefense {
	// Class-level features (keyed by class identity).
	static REGISTRY_CLASS = {
		// Barbarian: 10 + Dex + Con; a shield's bonus still applies.
		"barbarian|*": {ability: "con", allowShield: true, level: 1, label: "Barbarian: Unarmored Defense"},

		// Monk: 10 + Dex + Wis; only while wearing no armor and wielding no shield.
		"monk|*": {ability: "wis", allowShield: false, level: 1, label: "Monk: Unarmored Defense"},
	};

	// Subclass-level features (keyed by class + subclass identity).
	static REGISTRY_SUBCLASS = {
		// College of Dance (Bard): 10 + Dex + Cha; only while wearing no armor and wielding
		// no shield (per the parent "Dazzling Footwork" feature).
		"bard|xphb|dance|xphb": {ability: "cha", allowShield: false, level: 3, label: "College of Dance: Unarmored Defense"},
	};

	static _lookupClass (className, classSource) {
		if (!className) return null;
		const name = String(className).toLowerCase();
		const source = String(classSource || "").toLowerCase();
		return this.REGISTRY_CLASS[`${name}|${source}`] || this.REGISTRY_CLASS[`${name}|*`] || null;
	}

	static _lookupSubclass (className, classSource, subclassShortName, subclassSource) {
		if (!className || !subclassShortName) return null;
		const cn = String(className).toLowerCase();
		const cs = String(classSource || "").toLowerCase();
		const sn = String(subclassShortName).toLowerCase();
		const ss = String(subclassSource || "").toLowerCase();
		return this.REGISTRY_SUBCLASS[`${cn}|${cs}|${sn}|${ss}`]
			|| this.REGISTRY_SUBCLASS[`${cn}|*|${sn}|${ss}`]
			|| this.REGISTRY_SUBCLASS[`${cn}|${cs}|${sn}|*`]
			|| this.REGISTRY_SUBCLASS[`${cn}|*|${sn}|*`]
			|| null;
	}

	/**
	 * Resolve the applicable Unarmored Defense options for a character's classes.
	 *
	 * @param classInfos Resolved `[{ref, cls, subclass}]` (from
	 *        `CharactersDataUtil.pGetCharacterClasses`). `ref.level` gates whether the
	 *        feature has been gained yet.
	 * @return Array of `{ability, allowShield, label}`, one per qualifying feature. Empty
	 *         when the character has no Unarmored Defense features (or hasn't reached the
	 *         required level).
	 */
	static getOptions (classInfos) {
		if (!classInfos || !classInfos.length) return [];

		const out = [];

		classInfos.forEach(({ref, cls, subclass}) => {
			if (!cls) return;
			const level = ref?.level || 0;

			const clsEntry = this._lookupClass(cls.name, cls.source);
			if (clsEntry && level >= (clsEntry.level || 1)) {
				out.push({ability: clsEntry.ability, allowShield: !!clsEntry.allowShield, label: clsEntry.label});
			}

			if (subclass) {
				const scEntry = this._lookupSubclass(cls.name, cls.source, subclass.shortName, subclass.source);
				if (scEntry && level >= (scEntry.level || 1)) {
					out.push({ability: scEntry.ability, allowShield: !!scEntry.allowShield, label: scEntry.label});
				}
			}
		});

		return out;
	}
}

globalThis.CharactersUnarmoredDefense = CharactersUnarmoredDefense;
