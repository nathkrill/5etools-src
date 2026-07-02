/**
 * Helpers for loading game-content lists used by the character builder, and for
 * resolving `{page, source, hash}` reference tuples back into full entities.
 *
 * Lists combine site + prerelease + brew content (respecting the exclusion list),
 * matching the behaviour of other tools such as statgen.
 */
export class CharactersDataUtil {
	static _CACHE = {};

	/** Build a `{page, source, hash}` reference for an entity. */
	static getRef (ent, page) {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[page](ent);
		return {page, source: ent.source, hash};
	}

	/** Resolve a `{page, source, hash}` reference back into a (copied) entity, or null. */
	static async pGetEntity (ref) {
		if (!ref || !ref.page || !ref.hash) return null;
		return DataLoader.pCacheAndGet(ref.page, ref.source, ref.hash, {isCopy: true, isSilent: true});
	}

	static _isExcluded (ent, prop, page) {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[page](ent);
		return ExcludeUtil.isExcluded(hash, prop, ent.source);
	}

	static async _pLoadAll (page, prop) {
		const [site, prerelease, brew] = await Promise.all([
			DataLoader.pCacheAndGetAllSite(page),
			DataLoader.pCacheAndGetAllPrerelease(page),
			DataLoader.pCacheAndGetAllBrew(page),
		]);
		return [...site, ...prerelease, ...brew]
			.filter(it => !this._isExcluded(it, prop, page));
	}

	/** All races + subraces, flattened, sorted by name. */
	static async pLoadRaces () {
		if (this._CACHE.races) return this._CACHE.races;
		const all = await this._pLoadAll(UrlUtil.PG_RACES, "race");
		all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._CACHE.races = all;
	}

	/** All classes (subclasses attached under `.subclasses`), sorted by name. */
	static async pLoadClasses () {
		if (this._CACHE.classes) return this._CACHE.classes;

		const [classes, subclasses] = await Promise.all([
			this._pLoadAll(UrlUtil.PG_CLASSES, "class"),
			this._pLoadAll("subclass", "subclass"),
		]);

		const classesCpy = classes.map(it => MiscUtil.copyFast(it));

		const byKey = {};
		classesCpy.forEach(cls => {
			cls.subclasses = [];
			byKey[`${cls.name}|${cls.source}`.toLowerCase()] = cls;
		});

		subclasses.forEach(sc => {
			const key = `${sc.className}|${sc.classSource}`.toLowerCase();
			const cls = byKey[key];
			if (cls) cls.subclasses.push(sc);
		});

		classesCpy.forEach(cls => cls.subclasses.sort((a, b) => SortUtil.ascSortLower(a.name, b.name)));
		classesCpy.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));

		return this._CACHE.classes = classesCpy;
	}

	/** All backgrounds, sorted by name. */
	static async pLoadBackgrounds () {
		if (this._CACHE.backgrounds) return this._CACHE.backgrounds;
		const all = await this._pLoadAll(UrlUtil.PG_BACKGROUNDS, "background");
		all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._CACHE.backgrounds = all;
	}

	/** All feats, sorted by name. */
	static async pLoadFeats () {
		if (this._CACHE.feats) return this._CACHE.feats;
		const all = await this._pLoadAll(UrlUtil.PG_FEATS, "feat");
		all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._CACHE.feats = all;
	}

	/** All optional features (eldritch invocations, fighting styles, etc.), sorted by name. */
	static async pLoadOptionalFeatures () {
		if (this._CACHE.optionalfeatures) return this._CACHE.optionalfeatures;
		const all = await this._pLoadAll(UrlUtil.PG_OPT_FEATURES, "optionalfeature");
		all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._CACHE.optionalfeatures = all;
	}

	/** All spells, sorted by level then name. */
	static async pLoadSpells () {
		if (this._CACHE.spells) return this._CACHE.spells;
		const all = await this._pLoadAll(UrlUtil.PG_SPELLS, "spell");
		all.sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._CACHE.spells = all;
	}

	/** All items, sorted by name. */
	static async pLoadItems () {
		if (this._CACHE.items) return this._CACHE.items;
		const all = await Renderer.item.pBuildList();
		const filtered = all
			.filter(it => !it._isItemGroup)
			.filter(it => !this._isExcluded(it, "item", UrlUtil.PG_ITEMS));
		filtered.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
		return this._CACHE.items = filtered;
	}

	/** A short descriptive label for an entity, including its source. */
	static getDisplayWithSource (ent) {
		return `${ent.name} (${Parser.sourceJsonToAbv(ent.source)})`;
	}

	/* -------------------------------------------- Ref resolution from caches -------------------------------------------- */

	static _findInList (list, ref, page) {
		if (!ref?.hash || !list) return null;
		return list.find(ent => UrlUtil.URL_TO_HASH_BUILDER[page](ent) === ref.hash) || null;
	}

	/** Resolve a class ref to the cached class entity (with subclasses + dereferenced features). */
	static async pGetClass (ref) {
		const list = await this.pLoadClasses();
		return this._findInList(list, ref, UrlUtil.PG_CLASSES);
	}

	/** Resolve a subclass ref against a (already-resolved) class entity. */
	static getSubclassFromClass (cls, subclassRef) {
		if (!cls || !subclassRef?.hash) return null;
		return (cls.subclasses || []).find(sc => UrlUtil.URL_TO_HASH_BUILDER["subclass"](sc) === subclassRef.hash) || null;
	}

	static async pGetRace (ref) {
		const list = await this.pLoadRaces();
		return this._findInList(list, ref, UrlUtil.PG_RACES);
	}

	static async pGetBackground (ref) {
		const list = await this.pLoadBackgrounds();
		return this._findInList(list, ref, UrlUtil.PG_BACKGROUNDS);
	}

	static async pGetFeat (ref) {
		const list = await this.pLoadFeats();
		return this._findInList(list, ref, UrlUtil.PG_FEATS);
	}

	static async pGetOptionalFeature (ref) {
		const list = await this.pLoadOptionalFeatures();
		return this._findInList(list, ref, UrlUtil.PG_OPT_FEATURES);
	}

	/** Resolve a character's chosen optional features (e.g. eldritch invocations) to entities. */
	static async pGetCharacterOptionalFeatures (character) {
		const refs = character.optionalFeatures || [];
		if (!refs.length) return [];
		const list = await this.pLoadOptionalFeatures();
		return refs.map(ref => this._findInList(list, ref, UrlUtil.PG_OPT_FEATURES)).filter(Boolean);
	}

	/* -------------------------------------------- Eldritch Invocations -------------------------------------------- */

	/** All Eldritch Invocations (optional features whose `featureType` includes `"EI"`), sorted by name. */
	static async pLoadEldritchInvocations () {
		const all = await this.pLoadOptionalFeatures();
		return all.filter(ent => Array.isArray(ent.featureType) && ent.featureType.includes("EI"));
	}

	/**
	 * How many Eldritch Invocations the character is entitled to at their current level, read from the
	 * class's `optionalfeatureProgression` entry whose `featureType` includes `"EI"`.
	 * @param classInfos `[{ref, cls, subclass}]`
	 * @return {number}
	 */
	static getEldritchInvocationCount (classInfos) {
		let total = 0;
		(classInfos || []).forEach(ci => {
			const cls = ci?.cls;
			const level = ci?.ref?.level || 0;
			if (!cls || !level || !Array.isArray(cls.optionalfeatureProgression)) return;
			const prog = cls.optionalfeatureProgression
				.find(p => Array.isArray(p.featureType) && p.featureType.includes("EI"));
			if (!prog) return;

			if (Array.isArray(prog.progression)) {
				total += prog.progression[Math.min(prog.progression.length - 1, level - 1)] || 0;
			} else if (prog.progression && typeof prog.progression === "object") {
				// Object keyed by level threshold -> cumulative count.
				let best = 0;
				Object.entries(prog.progression).forEach(([lvlKey, cnt]) => {
					if (Number(lvlKey) <= level) best = Math.max(best, cnt);
				});
				total += best;
			}
		});
		return total;
	}

	/** The character's total level in Warlock-style ("pact") classes. */
	static getPactCasterLevel (classInfos) {
		return (classInfos || [])
			.filter(ci => ci?.cls?.casterProgression === "pact")
			.reduce((acc, ci) => acc + (ci?.ref?.level || 0), 0);
	}

	/**
	 * Soft eligibility check for an Eldritch Invocation given the character's current build. Used for
	 * *labelling* only — the picker still allows ineligible selections. Returns `true` when no
	 * prerequisite blocks the invocation given the supplied context.
	 * @param ent The optional-feature entity.
	 * @param ctx `{warlockLevel, pactBoon, patron, knownSpellUids: Set<string>}`
	 * @return {boolean}
	 */
	static isInvocationEligible (ent, ctx = {}) {
		const {warlockLevel = 0, pactBoon = null, patron = null, knownSpellUids = null} = ctx;
		const prereqs = ent?.prerequisite;
		if (!Array.isArray(prereqs) || !prereqs.length) return true;

		// `prerequisite` is an array of OR-groups; each group is an AND of its keys.
		return prereqs.some(group => {
			if (!group || typeof group !== "object") return true;

			// Level prerequisite: number OR {level, class, subclass}.
			if (group.level != null) {
				const lvlReq = typeof group.level === "object" ? (group.level.level || 0) : group.level;
				if (warlockLevel < lvlReq) return false;
			}

			// Pact boon (e.g. "Chain", "Blade", "Tome").
			if (group.pact != null) {
				if (!pactBoon || String(pactBoon).toLowerCase() !== String(group.pact).toLowerCase()) return false;
			}

			// Patron.
			if (group.patron != null) {
				if (!patron || String(patron).toLowerCase() !== String(group.patron).toLowerCase()) return false;
			}

			// Known-spell prerequisite (string UID or array; skip {choose}/{entry} structured forms softly).
			if (group.spell != null) {
				const spellReq = Array.isArray(group.spell) ? group.spell : [group.spell];
				const stringReqs = spellReq.filter(s => typeof s === "string");
				if (stringReqs.length && knownSpellUids) {
					const norm = s => s.split("#")[0].toLowerCase();
					const ok = stringReqs.some(req => knownSpellUids.has(norm(req)));
					if (!ok) return false;
				}
			}

			return true;
		});
	}

	static async pGetItem (ref) {
		const list = await this.pLoadItems();
		return this._findInList(list, ref, UrlUtil.PG_ITEMS);
	}

	/** Build a `{page, source, hash}` reference for an item entity. */
	static getItemRef (item) {
		return this.getRef(item, UrlUtil.PG_ITEMS);
	}

	/**
	 * Resolve all of a character's inventory entries to `{entry, item}` objects (loading the
	 * item cache once). `entry` is the stored line ({page, source, hash, quantity, equipped,
	 * attuned, notes}); `item` is the resolved entity (or null when unresolvable, e.g. removed
	 * brew). Entries are returned in stored order.
	 */
	static async pGetCharacterInventory (character) {
		const list = await this.pLoadItems();
		return (character.inventory || [])
			.map(entry => {
				if (entry.custom) {
					const item = {
						name: entry.name || "Custom item",
						source: "Homebrew",
						type: null,
						weight: Number(entry.weight) || 0,
						entries: entry.description ? [entry.description] : [],
						_isCustom: true,
					};
					return {entry, item};
				}
				return {entry, item: this._findInList(list, entry, UrlUtil.PG_ITEMS)};
			});
	}

	/**
	 * Resolve all of a character's classes to `{ref, cls, subclass}` objects, loading the
	 * class cache once. Returns entries in character order, skipping unresolvable refs.
	 */
	static async pGetCharacterClasses (character) {
		const list = await this.pLoadClasses();
		return (character.classes || [])
			.map(ref => {
				const cls = this._findInList(list, ref, UrlUtil.PG_CLASSES);
				if (!cls) return null;
				const subclass = this.getSubclassFromClass(cls, ref.subclass);
				return {ref, cls, subclass};
			})
			.filter(Boolean);
	}

	/* -------------------------------------------- Starting equipment -------------------------------------------- */

	/**
	 * Resolve a single `startingEquipment` entry into a normalized descriptor. Entries can be:
	 *  - a string item UID, e.g. `"chain mail|phb"` (optionally `"...|displayName"`);
	 *  - `{item, quantity, displayName, containsValue}` (a resolvable item, maybe holding coins);
	 *  - `{value}` (raw currency, in copper);
	 *  - `{special, quantity}` (flavor text, not a real item);
	 *  - `{equipmentType, quantity}` (a category choice, e.g. "a martial weapon").
	 *
	 * Returns `{kind, label, item, ref, quantity, valueCp}` where `kind` is one of
	 * `item | value | special | equipmentType`. `item`/`ref` are populated for resolved items.
	 */
	static async parseStartingEquipmentEntry (entry) {
		const items = await this.pLoadItems();

		const resolveUid = (uid) => {
			let unpacked;
			try { unpacked = DataUtil.proxy.unpackUid("item", uid, "item", {isLower: true}); } catch (e) { unpacked = null; }
			if (!unpacked) return null;
			const item = items.find(it => it.name.toLowerCase() === unpacked.name && it.source.toLowerCase() === unpacked.source)
				|| items.find(it => it.name.toLowerCase() === unpacked.name);
			return item || null;
		};

		// Plain string UID.
		if (typeof entry === "string") {
			const item = resolveUid(entry);
			return {
				kind: "item",
				item,
				ref: item ? this.getItemRef(item) : null,
				quantity: 1,
				valueCp: 0,
				label: item ? item.name : entry.split("|")[0],
			};
		}

		// Raw currency.
		if (entry.value != null) {
			return {kind: "value", item: null, ref: null, quantity: 1, valueCp: Number(entry.value) || 0, label: `${(Number(entry.value) || 0) / 100} gp`};
		}

		// Category choice (e.g. weaponMartial) — not resolvable to a single concrete item.
		if (entry.equipmentType != null) {
			const pretty = (entry.equipmentType || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
			return {kind: "equipmentType", item: null, ref: null, quantity: entry.quantity || 1, valueCp: 0, label: `Any ${pretty}`};
		}

		// Flavor-only special (e.g. "vestments").
		if (entry.special != null) {
			return {kind: "special", item: null, ref: null, quantity: entry.quantity || 1, valueCp: 0, label: entry.special};
		}

		// Resolvable item object.
		if (entry.item != null) {
			const item = resolveUid(entry.item);
			return {
				kind: "item",
				item,
				ref: item ? this.getItemRef(item) : null,
				quantity: entry.quantity || 1,
				valueCp: Number(entry.containsValue) || 0,
				label: entry.displayName || (item ? item.name : entry.item.split("|")[0]),
			};
		}

		return {kind: "special", item: null, ref: null, quantity: 1, valueCp: 0, label: JSON.stringify(entry)};
	}

	/**
	 * Parse a `startingEquipment` array (as found on classes' `defaultData` / `default` and on
	 * backgrounds) into a list of grant/choice groups for the builder.
	 *
	 * Returns `[{id, source, fixed: [entry], options: [{key, label, entries: [entry]}]}]` where each
	 * block carries either auto-granted `fixed` entries (the `_` key) and/or mutually-exclusive
	 * `options` (the `a`/`b`/... keys). `entries` are normalized via {@link parseStartingEquipmentEntry}.
	 *
	 * @param startingEquipment The raw `startingEquipment` array (blocks of `{_, a, b, ...}`).
	 * @param sourceLabel A human label for where this came from (e.g. class/background name).
	 * @param idPrefix Stable id prefix for choice-group state keys.
	 */
	static async parseStartingEquipment (startingEquipment, sourceLabel, idPrefix) {
		if (!startingEquipment?.length) return [];

		const out = [];
		for (let ixBlock = 0; ixBlock < startingEquipment.length; ++ixBlock) {
			const block = startingEquipment[ixBlock];
			if (!block || typeof block !== "object") continue;

			const fixed = [];
			const options = [];

			for (const key of Object.keys(block)) {
				const arr = block[key];
				if (!Array.isArray(arr)) continue;
				const entries = [];
				for (const raw of arr) entries.push(await this.parseStartingEquipmentEntry(raw));

				if (key === "_") {
					fixed.push(...entries);
				} else {
					options.push({key, label: key.toUpperCase(), entries});
				}
			}

			out.push({id: `${idPrefix}-${ixBlock}`, source: sourceLabel, fixed, options});
		}
		return out;
	}

	/* -------------------------------------------- Spell lists -------------------------------------------- */

	/**
	 * Build the set of spells a character may select, based on the spell lists of all the
	 * classes (and subclasses) they have. Returns:
	 *
	 * `{byLevel: {0: [spell], 1: [spell], ...}, refOf: (spell) => ref}`
	 *
	 * Spells are filtered to those at or below the character's maximum castable spell level
	 * (cantrips, level 0, are always included). Each spell is the cached entity; use `refOf`
	 * to derive a `{page, source, hash}` reference for storage.
	 *
	 * @param classInfos Resolved `[{ref, cls, subclass}]` (from {@link pGetCharacterClasses}).
	 * @param maxSpellLevel Highest leveled spell to include (cantrips always included).
	 */
	static async pGetCharacterSpellList (classInfos, maxSpellLevel) {
		const all = await this.pLoadSpells();

		// Class identities the character has (name+source, lowercased) for membership tests.
		const classKeys = new Set(
			(classInfos || [])
				.filter(ci => ci.cls?.spellcastingAbility)
				.map(ci => `${ci.cls.name}|${ci.cls.source}`.toLowerCase()),
		);
		const subclassKeys = new Set(
			(classInfos || [])
				.filter(ci => ci.subclass)
				.map(ci => `${ci.cls.name}|${ci.subclass.name}`.toLowerCase()),
		);

		const byLevel = {};
		all.forEach(sp => {
			if (sp.level > maxSpellLevel && sp.level !== 0) return;

			let isOnList = false;

			const fromClass = Renderer.spell.getCombinedClasses(sp, "fromClassList");
			if (fromClass.some(c => classKeys.has(`${c.name}|${c.source}`.toLowerCase()))) isOnList = true;

			if (!isOnList) {
				const fromSub = Renderer.spell.getCombinedClasses(sp, "fromSubclass");
				if (fromSub.some(c => subclassKeys.has(`${c.class?.name}|${c.subclass?.name}`.toLowerCase()))) isOnList = true;
			}

			if (!isOnList) return;

			(byLevel[sp.level] = byLevel[sp.level] || []).push(sp);
		});

		Object.values(byLevel).forEach(arr => arr.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source)));

		return {
			byLevel,
			refOf: (sp) => this.getRef(sp, UrlUtil.PG_SPELLS),
		};
	}

	/* -------------------------------------------- Granted / additional spells -------------------------------------------- */

	/** Resolve a freestanding spell UID (e.g. `"mage armor"` or `"mage armor|xphb"`) against the loaded spell list. */
	static _findSpellByUid (allSpells, uid) {
		if (typeof uid !== "string") return null;
		const unpacked = DataUtil.proxy.unpackUid("spell", uid, "spell", {isLower: true});
		if (!unpacked?.name) return null;
		const nameLower = unpacked.name.toLowerCase();
		const srcLower = unpacked.source ? unpacked.source.toLowerCase() : null;
		// Prefer an exact name+source match; otherwise fall back to the first name match.
		let fallback = null;
		for (const sp of allSpells) {
			if (sp.name.toLowerCase() !== nameLower) continue;
			if (srcLower && sp.source.toLowerCase() === srcLower) return sp;
			fallback = fallback || sp;
		}
		return fallback;
	}

	/**
	 * Pull concrete spell UID strings out of a single level-meta value, which may be a flat
	 * array of spell items, or a recharge block (`{rest: {"1": [...]}}`, `{_: [...]}`, etc.).
	 * Filter-expression items (`{choose}`, `{all}`) require a spell filter UI and are skipped.
	 */
	static _collectAdditionalSpellUids (levelMeta, out) {
		if (levelMeta == null) return;
		if (levelMeta instanceof Array) {
			levelMeta.forEach(it => { if (typeof it === "string") out.push(it); });
			return;
		}
		if (typeof levelMeta !== "object") return;
		// Recharge block: values are either arrays or `{count: [...]}` maps.
		Object.values(levelMeta).forEach(inner => {
			if (inner instanceof Array) this._collectAdditionalSpellUids(inner, out);
			else if (inner && typeof inner === "object") Object.values(inner).forEach(arr => this._collectAdditionalSpellUids(arr, out));
		});
	}

	/**
	 * Walk an entity's `additionalSpells` blocks and split them into:
	 *  - `granted`: spells the character automatically gains (from `innate`/`known`/`prepared`),
	 *    gated by the character's level in the granting class.
	 *  - `expandedUids`: spell UIDs added to the *selectable* list (Warlock-style `expanded`).
	 *
	 * `levelKeys` are interpreted as: `"_"`/`"will"`/`"ritual"` => always; numeric (`"3"`) => the
	 * character level in the source class must be >= that; `"s1".."s9"` (expanded) => spell-level
	 * gating handled by the caller's max-spell-level filter.
	 *
	 * @param ent The granting entity (class, subclass, race, feat).
	 * @param sourceLabel Human-readable label for where the grant came from (e.g. "Great Old One").
	 * @param charLevel Character level in the relevant class (for numeric-level gating); pass a large
	 *        number (or omit) for race/feat grants that are not class-level gated.
	 * @param granted Output array of `{uid, sourceLabel, kind}` where `kind` is `innate|known|prepared`.
	 * @param expandedUids Output array of expanded spell UID strings.
	 */
	static _collectGrantsFromEntity ({ent, sourceLabel, charLevel = Number.MAX_SAFE_INTEGER}, granted, expandedUids) {
		const blocks = ent?.additionalSpells;
		if (!blocks?.length) return;

		blocks.forEach(block => {
			if (!block || typeof block !== "object") return;

			["innate", "known", "prepared"].forEach(kind => {
				const byLevelKey = block[kind];
				if (!byLevelKey || typeof byLevelKey !== "object") return;
				Object.entries(byLevelKey).forEach(([levelKey, levelMeta]) => {
					// Numeric level keys gate on the character's class level.
					const numLevel = Number(levelKey);
					if (!isNaN(numLevel) && numLevel > charLevel) return;
					const uids = [];
					this._collectAdditionalSpellUids(levelMeta, uids);
					uids.forEach(uid => granted.push({uid, sourceLabel, kind}));
				});
			});

			// `expanded` adds to the selectable list (keyed by spell level `s1`..`s9` or class level).
			const expanded = block.expanded;
			if (expanded && typeof expanded === "object") {
				Object.values(expanded).forEach(levelMeta => this._collectAdditionalSpellUids(levelMeta, expandedUids));
			}
		});
	}

	/**
	 * Build the set of spells granted to a character by their classes, subclasses, race, and feats
	 * via `additionalSpells`, plus any `expanded` (selectable) spell UIDs.
	 *
	 * Returns `{granted: [{ref, ent, sourceLabel, kind}], expanded: [spellEntity]}` where `granted`
	 * spells are auto-known / always-prepared (locked in the manager) and `expanded` spells are
	 * added to the selectable list. Spells above `maxSpellLevel` are dropped (cantrips kept).
	 *
	 * @param classInfos Resolved `[{ref, cls, subclass}]` (from {@link pGetCharacterClasses}).
	 * @param race Resolved race entity (or null).
	 * @param feats Resolved feat entities (or empty).
	 * @param maxSpellLevel Highest leveled spell to include.
	 * @param [optionalFeatures] Resolved optional-feature entities (e.g. chosen eldritch invocations).
	 */
	static async getGrantedSpells (classInfos, race, feats, maxSpellLevel, optionalFeatures = []) {
		const allSpells = await this.pLoadSpells();

		const granted = []; // {uid, sourceLabel, kind}
		const expandedUids = [];

		(classInfos || []).forEach(ci => {
			const charLevel = ci.ref?.level || 1;
			if (ci.cls) this._collectGrantsFromEntity({ent: ci.cls, sourceLabel: ci.cls.name, charLevel}, granted, expandedUids);
			if (ci.subclass) this._collectGrantsFromEntity({ent: ci.subclass, sourceLabel: ci.subclass.name, charLevel}, granted, expandedUids);
		});

		if (race) this._collectGrantsFromEntity({ent: race, sourceLabel: race.name}, granted, expandedUids);
		(feats || []).forEach(ft => this._collectGrantsFromEntity({ent: ft, sourceLabel: ft.name}, granted, expandedUids));
		// Optional features (e.g. eldritch invocations) grant spells the same way; not class-level gated.
		(optionalFeatures || []).forEach(of => this._collectGrantsFromEntity({ent: of, sourceLabel: of.name}, granted, expandedUids));

		// Resolve granted UIDs to entities, de-duplicating by spell (keep the first source label),
		// and drop spells above the character's max castable level (cantrips always kept).
		const grantedOut = [];
		const seenGranted = new Set();
		granted.forEach(({uid, sourceLabel, kind}) => {
			const sp = this._findSpellByUid(allSpells, uid);
			if (!sp) return;
			if (sp.level > maxSpellLevel && sp.level !== 0) return;
			const ref = this.getRef(sp, UrlUtil.PG_SPELLS);
			const key = `${ref.source}|${ref.hash}`;
			if (seenGranted.has(key)) return;
			seenGranted.add(key);
			grantedOut.push({ref, ent: sp, sourceLabel, kind});
		});

		// Resolve expanded UIDs to entities (de-duplicated), dropping over-level spells.
		const expandedOut = [];
		const seenExpanded = new Set();
		expandedUids.forEach(uid => {
			const sp = this._findSpellByUid(allSpells, uid);
			if (!sp) return;
			if (sp.level > maxSpellLevel && sp.level !== 0) return;
			const key = `${sp.source}|${sp.name}`.toLowerCase();
			if (seenExpanded.has(key)) return;
			seenExpanded.add(key);
			expandedOut.push(sp);
		});

		return {granted: grantedOut, expanded: expandedOut};
	}

	/* -------------------------------------------- Proficiency parsing -------------------------------------------- */

	/**
	 * Normalize an array of "skillProficiencies"-style blocks (as found on races, backgrounds, and
	 * class `startingProficiencies.skills`) into `{fixed: string[], choices: [{from: string[], count}]}`.
	 *
	 * Handles shapes like:
	 *  - `[{"history": true, "intimidation": true}]` (fixed)
	 *  - `[{"choose": {"from": [...], "count": 2}}]`
	 *  - `[{"any": 2}]` / `[{"anyStandard": 2}]` (choose from all skills)
	 *  - class form: `[{"choose": {"from": [...], "count": 2}}]`
	 */
	static parseSkillProficiencies (blocks) {
		const out = {fixed: [], choices: []};
		if (!blocks) return out;
		const arr = blocks instanceof Array ? blocks : [blocks];
		const allSkills = Object.keys(CharacterModel.SKILL_TO_ABILITY);

		arr.forEach(block => {
			if (!block || typeof block !== "object") return;
			Object.entries(block).forEach(([key, val]) => {
				if (key === "choose") {
					const from = (val.from || []).filter(it => allSkills.includes(it));
					if (from.length) out.choices.push({from, count: val.count || 1});
				} else if (key === "any") {
					out.choices.push({from: [...allSkills], count: val || 1});
				} else if (allSkills.includes(key) && val === true) {
					out.fixed.push(key);
				}
				// Ignore unsupported shapes (e.g. nested conditional grants).
			});
		});
		return out;
	}

	/** Class starting save proficiencies live under `startingProficiencies.savingThrows` or the `proficiency` array. */
	static getClassSaveProficiencies (cls) {
		if (!cls) return [];
		const fromStarting = cls.startingProficiencies?.savingThrows;
		if (fromStarting?.length) return fromStarting.map(it => it.toLowerCase()).filter(it => CharacterModel.ABILITIES.includes(it));
		// Fallback: older/`proficiency` array of ability abbreviations.
		if (cls.proficiency?.length) return cls.proficiency.map(it => it.toLowerCase()).filter(it => CharacterModel.ABILITIES.includes(it));
		return [];
	}

	/** Flatten a class `startingProficiencies.{armor,weapons,tools}` block to display strings. */
	static getClassSimpleProficiencies (cls, prop) {
		const list = cls?.startingProficiencies?.[prop];
		if (!list?.length) return [];
		return list
			.map(it => {
				if (typeof it === "string") return it;
				if (it?.proficiency) return it.proficiency;
				if (it?.full) return it.full;
				return null;
			})
			.filter(Boolean);
	}

	/**
	 * Normalize a class' tool proficiencies into `{fixed: string[], choices: [{id, label, from, count}]}`.
	 *
	 * Prefers the structured `startingProficiencies.toolProficiencies` block (which encodes choices such
	 * as `{anyMusicalInstrument: 3}`) when present, since the plain `startingProficiencies.tools` array
	 * stores only human-readable strings (e.g. `"Choose three {@item Musical Instrument|XPHB}"`).
	 *
	 * Handles shapes like:
	 *  - `{"thieves' tools": true}` (fixed)
	 *  - `{anyTool: n}` / `{anyArtisansTool: n}` / `{anyMusicalInstrument: n}` / `{anyGamingSet: n}`
	 *  - `{choose: {from: [...], count: n}}`
	 */
	static parseToolProficiencies (cls) {
		const out = {fixed: [], choices: []};
		const list = cls?.startingProficiencies?.toolProficiencies;

		// Fall back to the (display-only) `tools` strings when no structured block is present.
		if (!list?.length) {
			out.fixed = this.getClassSimpleProficiencies(cls, "tools");
			return out;
		}

		let ixChoice = 0;
		list.forEach(block => {
			if (!block || typeof block !== "object") {
				if (typeof block === "string") out.fixed.push(block);
				return;
			}

			Object.entries(block).forEach(([key, val]) => {
				if (val === false) return;

				if (key === "choose") {
					const from = (val.from || []).filter(Boolean);
					if (from.length) out.choices.push({id: `tool-choose-${ixChoice++}`, label: "Tools", from, count: val.count || 1});
					return;
				}

				const mapped = Renderer.generic.getMappedAnyProficiency({keyAny: key, countRaw: val});
				if (mapped) {
					out.choices.push({
						id: `tool-${key}-${ixChoice++}`,
						label: mapped.name,
						from: mapped.from.map(it => it.name),
						count: mapped.count,
					});
					return;
				}

				// Fixed proficiency (e.g. `{"thieves' tools": true}`).
				if (val === true) out.fixed.push(key);
			});
		});

		return out;
	}

	/** Parse a class hit die into `{die, faces}` from `cls.hd` ({number, faces}). */
	static getClassHitDie (cls) {
		const faces = cls?.hd?.faces;
		if (!faces) return null;
		return {die: `d${faces}`, faces};
	}
}

globalThis.CharactersDataUtil = CharactersDataUtil;
