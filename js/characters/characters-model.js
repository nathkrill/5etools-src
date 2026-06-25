/**
 * Character data model + factory helpers.
 *
 * A character is stored as a plain serializable object. References to game content
 * (race, class, background, feats, spells, items) are stored as `{page, source, hash}`
 * tuples and resolved on demand via `DataLoader.pCacheAndGet`, keeping saves small and
 * allowing the underlying data to update over time.
 */
export class CharacterModel {
	static SCHEMA_VERSION = 1;

	static ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

	static ABILITY_TO_FULL = {
		str: "Strength",
		dex: "Dexterity",
		con: "Constitution",
		int: "Intelligence",
		wis: "Wisdom",
		cha: "Charisma",
	};

	// skill -> ability
	static SKILL_TO_ABILITY = {
		"acrobatics": "dex",
		"animal handling": "wis",
		"arcana": "int",
		"athletics": "str",
		"deception": "cha",
		"history": "int",
		"insight": "wis",
		"intimidation": "cha",
		"investigation": "int",
		"medicine": "wis",
		"nature": "int",
		"perception": "wis",
		"performance": "cha",
		"persuasion": "cha",
		"religion": "int",
		"sleight of hand": "dex",
		"stealth": "dex",
		"survival": "wis",
	};

	/**
	 * Create a new, empty character object.
	 * @param [opts]
	 * @param [opts.name]
	 * @return {object}
	 */
	static getNewCharacter ({name = "New Character"} = {}) {
		return {
			schemaVersion: this.SCHEMA_VERSION,
			id: CryptUtil.uid(),
			dateCreated: Date.now(),
			dateModified: Date.now(),

			name,

			// Content references ({page, source, hash})
			race: null,
			background: null,
			feats: [], // [{page, source, hash}]
			// [{page, source, hash, level, subclass: {page, source, hash} | null}]
			classes: [],

			// Ability scores (final, including bonuses applied during build)
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},

			// Proficiencies (lowercase skill / save ability names)
			proficiencies: {
				saves: [], // ["str", "con"]
				skills: [], // ["athletics", "perception"]
				skillsExpertise: [], // subset of skills with doubled proficiency
				armor: [],
				weapons: [],
				tools: [],
				languages: [],
			},

			// Combat / vitals
			hp: {max: 0, current: 0, temp: 0},
			hitDice: [], // [{die: "d10", total: 1, used: 0}]
			ac: {base: null, override: null}, // null base => auto 10 + dex
			speed: 30,

			// Spellcasting
			spells: {
				// per-class spellcasting; keyed by class index
				slots: {}, // {"1": {used, max}, ...} spell-level => slot usage
				known: [], // [{page, source, hash, prepared: bool, alwaysPrepared: bool}]
			},

			// Inventory
			inventory: [], // [{page, source, hash, quantity, equipped, attuned}]

			currency: {pp: 0, gp: 0, ep: 0, sp: 0, cp: 0},

			notes: "",
		};
	}

	/** Total character level across all classes. */
	static getTotalLevel (character) {
		return (character.classes || []).reduce((acc, it) => acc + (it.level || 0), 0);
	}

	/** Proficiency bonus from total level. */
	static getProficiencyBonus (character) {
		const lvl = Math.max(1, this.getTotalLevel(character));
		return Math.floor((lvl - 1) / 4) + 2;
	}

	/** Ability modifier from a raw score. */
	static getAbilityModifier (score) {
		return Math.floor(((score ?? 10) - 10) / 2);
	}

	/** Migrate an older character object to the current schema, mutating in place. */
	static migrate (character) {
		if (character == null) return character;
		character.schemaVersion ||= 1;
		// Future migrations branch on schemaVersion here.
		character.schemaVersion = this.SCHEMA_VERSION;
		return character;
	}
}

globalThis.CharacterModel = CharacterModel;
