<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { command, hookStatus, keyLabelMode, monitorCount, navigate, state, updateSettings } from "../../store"
import { toast } from "../../toast"
import RangeSetting from "./RangeSetting.vue"
import {
	CONTROLLER_STYLES,
	COUNTER_TOKENS,
	DEFAULT_COUNTER_LIMIT,
	HAND_ANIMATIONS,
	RANGES,
	SETTINGS_TABS,
	switchesFor,
	type SettingsTab,
} from "./schema"
import SettingRow from "./SettingRow.vue"
import SwitchSetting from "./SwitchSetting.vue"

defineProps<{ visible: boolean }>()

const appVersion = `v${__APP_VERSION__}`
const buildVersion = `Build ${__BUILD_VERSION__}`

const activeTab = ref<SettingsTab>("general")
const settings = computed(() => state.value.settings)

/* Text fields keep a draft and save on blur so typing doesn't round-trip through the main process. */
const counterFormatDraft = ref(settings.value.counterFormat)
const counterLimitDraft = ref(String(settings.value.counterLimit ?? DEFAULT_COUNTER_LIMIT))
watch(
	() => settings.value.counterFormat,
	value => (counterFormatDraft.value = value),
)
watch(
	() => settings.value.counterLimit,
	value => (counterLimitDraft.value = String(value ?? DEFAULT_COUNTER_LIMIT)),
)
const draftCounterLimit = () => Number(counterLimitDraft.value) || DEFAULT_COUNTER_LIMIT

function saveCounterLimit() {
	if (settings.value.counterLimit !== null) void updateSettings({ counterLimit: draftCounterLimit() })
}

function setUnlimited(unlimited: boolean) {
	void updateSettings({ counterLimit: unlimited ? null : draftCounterLimit() })
}

function cycleMonitor() {
	void updateSettings({ monitor: (settings.value.monitor + 1) % Math.max(1, monitorCount.value) })
}

function openKeyboardLabels() {
	keyLabelMode.value = "ui"
	navigate("keyboard-labels")
}

async function unlockAll() {
	if ((await command("unlock-all")).ok) toast("All characters, accessories and emotes unlocked")
}

function resetData() {
	if (confirm("Reset all collection data, counters, presets and settings? This cannot be undone."))
		void command("reset-data")
}

async function exportData() {
	const result = await command("export-data")
	if (result.ok && result.result === "exported") toast("Data exported")
}

async function importData() {
	if (!confirm("Importing replaces your current collection and settings. Continue?")) return
	const result = await command("import-data")
	if (result.ok && result.result === "imported") toast("Data imported")
}

const selectValue = (event: Event) => (event.target as HTMLSelectElement).value
</script>

<template>
	<section id="page-settings" class="page module-block settings-module" :hidden="!visible">
		<div class="panel-content">
			<div id="settingsRows">
				<div class="atlas-tab settings-tabs" role="tablist">
					<button
						v-for="tab in SETTINGS_TABS"
						:key="tab.id"
						class="atlas-tab-item"
						:class="{ selected: activeTab === tab.id }"
						type="button"
						role="tab"
						:aria-selected="activeTab === tab.id"
						@click="activeTab = tab.id"
					>
						{{ tab.label }}
					</button>
				</div>
				<div class="settings-tab-content">
					<div class="settings-tab-panel" role="tabpanel" :hidden="activeTab !== 'general'">
						<SettingRow title="Application">
							<button id="quit" class="setting-btn" type="button" @click="command('quit')">
								Quit App
							</button>
						</SettingRow>
						<SwitchSetting v-for="spec in switchesFor('general')" :key="spec.key" :spec="spec" />
						<SettingRow
							:title="`Display Screen: ${settings.monitor + 1} / ${monitorCount}`"
							title-id="monitorLabel"
							description="Press F8 to cycle"
						>
							<button class="setting-btn" type="button" @click="cycleMonitor">Cycle Screen</button>
						</SettingRow>
					</div>

					<div class="settings-tab-panel" role="tabpanel" :hidden="activeTab !== 'pet'">
						<SettingRow title="Pet Position">
							<button id="recenter" class="setting-btn" type="button" @click="command('recenter')">
								Recenter Pet
							</button>
						</SettingRow>
						<SwitchSetting v-for="spec in switchesFor('pet')" :key="spec.key" :spec="spec" />
						<RangeSetting :spec="RANGES.opacity" />
						<RangeSetting :spec="RANGES.scale" />
						<SettingRow title="Counter Format" :description="`Tokens: ${COUNTER_TOKENS}.`">
							<input
								v-model="counterFormatDraft"
								class="setting-counter-format"
								data-setting="counterFormat"
								aria-label="Counter Format"
								type="text"
								maxlength="128"
								@blur="updateSettings({ counterFormat: counterFormatDraft })"
								@keydown.enter="($event.target as HTMLInputElement).blur()"
							/>
						</SettingRow>
						<SettingRow
							title="Counter Limit"
							description="Reset the counter after this value, or keep counting."
						>
							<div class="setting-content">
								<input
									id="counterLimitInput"
									v-model="counterLimitDraft"
									class="setting-number"
									data-setting="counterLimit"
									aria-label="Counter Limit"
									type="number"
									min="1"
									:max="Number.MAX_SAFE_INTEGER"
									step="1"
									:disabled="settings.counterLimit === null"
									@blur="saveCounterLimit"
								/>
								<label class="setting-unlimited">
									<input
										data-setting="counterUnlimited"
										aria-label="Unlimited Counter"
										type="checkbox"
										:checked="settings.counterLimit === null"
										@change="setUnlimited(($event.target as HTMLInputElement).checked)"
									/>
									<span>Unlimited</span>
								</label>
							</div>
						</SettingRow>
					</div>

					<div class="settings-tab-panel" role="tabpanel" :hidden="activeTab !== 'input'">
						<SwitchSetting v-for="spec in switchesFor('input')" :key="spec.key" :spec="spec" />
						<SettingRow title="Keyboard Labels" description="Customize the names shown for keyboard keys.">
							<button class="setting-btn" type="button" @click="openKeyboardLabels">Edit Labels</button>
						</SettingRow>
						<SettingRow title="Hand Animation" description="Choose how the character moves its arms.">
							<select
								class="setting-select"
								data-setting="handAnimation"
								aria-label="Hand Animation"
								:value="settings.handAnimation"
								@change="
									updateSettings({
										handAnimation: selectValue($event) as typeof settings.handAnimation,
									})
								"
							>
								<option v-for="option in HAND_ANIMATIONS" :key="option.value" :value="option.value">
									{{ option.label }}
								</option>
							</select>
						</SettingRow>
					</div>

					<div class="settings-tab-panel" role="tabpanel" :hidden="activeTab !== 'bubbles'">
						<SwitchSetting v-for="spec in switchesFor('bubbles')" :key="spec.key" :spec="spec" />
						<RangeSetting :spec="RANGES.bubbleLifetime" />
						<SettingRow title="Bubble Color" description="Used for key and emote bubbles.">
							<input
								class="setting-color"
								data-setting="bubbleColor"
								aria-label="Bubble Color"
								type="color"
								:value="settings.bubbleColor"
								@input="updateSettings({ bubbleColor: ($event.target as HTMLInputElement).value })"
							/>
						</SettingRow>
						<SettingRow
							title="Controller Bubble Style"
							description="Choose Xbox or PlayStation button labels."
						>
							<select
								class="setting-select"
								data-setting="controllerStyle"
								aria-label="Controller Bubble Style"
								:value="settings.controllerStyle"
								@change="
									updateSettings({
										controllerStyle: selectValue($event) as typeof settings.controllerStyle,
									})
								"
							>
								<option v-for="option in CONTROLLER_STYLES" :key="option.value" :value="option.value">
									{{ option.label }}
								</option>
							</select>
						</SettingRow>
					</div>

					<div class="settings-tab-panel" role="tabpanel" :hidden="activeTab !== 'data'">
						<SettingRow title="Save Data" description="Open the folder containing your collection save.">
							<button id="openFolder" class="setting-btn" type="button" @click="command('folder')">
								Open Save Folder
							</button>
						</SettingRow>
						<SettingRow title="Collection Data" description="Unlock every item or start over.">
							<div class="setting-content">
								<button
									id="unlockAll"
									class="setting-btn"
									type="button"
									:disabled="settings.onlineMode"
									:title="settings.onlineMode ? 'Not available in online mode' : ''"
									@click="unlockAll"
								>
									Unlock All
								</button>
								<button id="resetData" class="setting-btn" type="button" @click="resetData">
									Reset
								</button>
							</div>
						</SettingRow>
						<SettingRow
							title="Backup and Restore"
							description="Export or import your collection and settings as a JSON file."
						>
							<div class="setting-content">
								<button class="setting-btn" type="button" @click="exportData">Export Data</button>
								<button class="setting-btn" type="button" @click="importData">Import Data</button>
							</div>
						</SettingRow>
					</div>
				</div>
			</div>
			<div class="setting-copyright">
				<span>Wuwa Tappo</span>
				<span id="appVersion">{{ appVersion }}</span>
				<span id="buildVersion">{{ buildVersion }}</span>
				<span id="hookStatus">{{ hookStatus }}</span>
			</div>
		</div>
	</section>
</template>
