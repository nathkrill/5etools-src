import {CharactersManager} from "./characters/characters-manager.js";
import {CharactersStorage} from "./characters/characters-storage.js";
import {CharacterBuilder} from "./characters/characters-builder.js";
import {CharacterSheet} from "./characters/characters-sheet.js";

class CharactersPage {
	constructor () {
		this._characters = [];
		this._pSaveDebounced = CharactersStorage.getSaveAllDebounced();

		this._manager = null;
		this._wrpMain = null;
	}

	async pInit () {
		await Promise.all([
			PrereleaseUtil.pInit(),
			BrewUtil2.pInit(),
		]);
		await ExcludeUtil.pInitialise();

		this._characters = await CharactersStorage.pLoadAll();

		this._wrpMain = es(`#characters-main`);

		this._manager = new CharactersManager({
			fnGetCharacters: () => this._characters,
			fnAddCharacters: (characters) => this._characters.push(...characters),
			fnDeleteCharacter: (id) => {
				const ix = this._characters.findIndex(it => it.id === id);
				if (~ix) this._characters.splice(ix, 1);
			},
			fnOnChange: () => this._doSave(),
			fnOpenCharacter: (id) => this._openCharacter(id),
		});

		this._renderManager();

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	_doSave () {
		this._characters.forEach(it => { it.dateModified = Date.now(); });
		this._pSaveDebounced(this._characters);
	}

	_renderManager () {
		this._wrpMain.empty();
		this._manager.render(this._wrpMain);
	}

	async _openCharacter (id) {
		const character = this._characters.find(it => it.id === id);
		if (!character) return;

		this._wrpMain.empty();

		const sheet = new CharacterSheet({
			character,
			fnBack: () => this._renderManager(),
			fnEdit: () => this._pEditCharacter(character),
			fnOnChange: () => this._doSave(),
		});
		await sheet.pRender(this._wrpMain);
	}

	async _pEditCharacter (character) {
		const builder = new CharacterBuilder({character});
		const updated = await builder.pOpen();
		if (!updated) return;

		const ix = this._characters.findIndex(it => it.id === character.id);
		updated.id = character.id;
		updated.dateCreated = character.dateCreated;
		if (~ix) this._characters[ix] = updated;
		this._doSave();
		this._openCharacter(character.id);
	}
}

const charactersPage = new CharactersPage();
window.addEventListener("load", () => charactersPage.pInit());
globalThis.dbg_charactersPage = charactersPage;
