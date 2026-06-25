import {DmScreenPanelAppBase} from "./dmscreen-panelapp-base.js";
import {CharactersStorage} from "../characters/characters-storage.js";
import {CharacterSheet} from "../characters/characters-sheet.js";

export class CharacterPanelApp extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);

		this._id = this._savedState?.id ?? null;
	}

	_getPanelElement (board, state) {
		const id = state?.id ?? null;
		this._id = id;

		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 ve-overflow-y-auto dm__panel-bg"></div>`;

		this._pRenderCharacter({wrpPanel, id})
			.catch(err => {
				wrpPanel.empty();
				ee`<div class="ve-flex-vh-center ve-w-100 ve-h-100 ve-muted ve-small italic">Failed to load character.</div>`.appendTo(wrpPanel);
				setTimeout(() => { throw err; });
			});

		return wrpPanel;
	}

	async _pRenderCharacter ({wrpPanel, id}) {
		if (id == null) {
			ee`<div class="ve-flex-vh-center ve-w-100 ve-h-100 ve-muted ve-small italic">No character selected.</div>`.appendTo(wrpPanel);
			return;
		}

		const all = await CharactersStorage.pLoadAll();
		const character = all.find(it => it.id === id);

		if (!character) {
			ee`<div class="ve-flex-vh-center ve-w-100 ve-h-100 ve-muted ve-small italic">Character not found. It may have been deleted on the Characters page.</div>`.appendTo(wrpPanel);
			return;
		}

		const saveAllDebounced = CharactersStorage.getSaveAllDebounced();

		const sheet = new CharacterSheet({
			character,
			fnBack: null,
			fnEdit: null,
			fnOnChange: () => saveAllDebounced(all),
		});

		await sheet.pRender(wrpPanel);
	}

	getState () {
		return {id: this._id};
	}
}
