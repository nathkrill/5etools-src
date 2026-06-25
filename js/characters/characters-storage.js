import {CharacterModel} from "./characters-model.js";

/**
 * Persistence layer for characters.
 *
 * Characters are stored as a single array under `VeCt.STORAGE_CHARACTERS` in IndexedDB
 * (via `StorageUtil`). Saves are debounced to avoid thrashing on rapid edits.
 */
export class CharactersStorage {
	static async pLoadAll () {
		const stored = await StorageUtil.pGet(VeCt.STORAGE_CHARACTERS);
		if (!stored || !Array.isArray(stored)) return [];
		return stored.map(it => CharacterModel.migrate(it));
	}

	static async pSaveAll (characters) {
		return StorageUtil.pSet(VeCt.STORAGE_CHARACTERS, characters);
	}

	static getSaveAllDebounced () {
		return MiscUtil.debounce(
			(characters) => CharactersStorage.pSaveAll(characters),
			VeCt.DUR_DEBOUNCE_SAVE,
		);
	}

	/** Trigger a browser download of a single character as JSON. */
	static downloadCharacter (character) {
		const filename = (character.name || "character").replace(/[^\w-]+/g, "_") || "character";
		DataUtil.userDownload(filename, character, {fileType: "character"});
	}

	/** Trigger a browser download of all characters as a JSON collection. */
	static downloadAll (characters) {
		DataUtil.userDownload("characters", {characters}, {fileType: "characters"});
	}

	/**
	 * Prompt the user to upload one or more character JSON files.
	 * @return {Promise<Array<object>>} array of character objects (may be empty)
	 */
	static async pUploadCharacters () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({
			expectedFileTypes: ["character", "characters"],
		});

		DataUtil.doHandleFileLoadErrorsGeneric(errors);

		if (!jsons?.length) return [];

		const out = [];
		jsons.forEach(json => {
			if (json == null) return;

			// A "characters" collection file.
			// Note: the upload helper strips `fileType`/`siteVersion` before returning, so detect
			// the collection by its shape (a `characters` array) rather than by `fileType`.
			if (Array.isArray(json.characters)) {
				json.characters.forEach(it => out.push(this._cleanUploaded(it)));
				return;
			}

			// A single character file (or a bare character object)
			out.push(this._cleanUploaded(json));
		});

		return out.map(it => CharacterModel.migrate(it));
	}

	static _cleanUploaded (character) {
		const cpy = MiscUtil.copyFast(character);
		delete cpy.fileType;
		delete cpy.siteVersion;
		// Always assign a fresh id on import to avoid clobbering existing characters
		cpy.id = CryptUtil.uid();
		cpy.name ||= "Imported Character";
		return cpy;
	}
}

globalThis.CharactersStorage = CharactersStorage;
