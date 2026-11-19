<script setup lang="ts">
import { ref } from "vue"
import { assetPath } from "../../../shared/assets"
import type { Preset } from "../../../shared/types"
import { command, getItem, navigate, state } from "../../store"

defineProps<{ visible: boolean }>()

const DEFAULT_PRESET_NAME = "My Outfit"
const name = ref("")

async function savePreset() {
	const result = await command("preset-save", name.value || DEFAULT_PRESET_NAME)
	if (!result.ok) return
	name.value = ""
	navigate("collection")
}

function deletePreset(preset: Preset) {
	if (confirm(`Delete preset “${preset.name}”?`)) void command("preset-delete", preset.id)
}
</script>

<template>
	<section id="page-presets" class="page module-block" :hidden="!visible">
		<div id="presetsRoot">
			<div class="panel-content">
				<div class="save-preset">
					<input id="presetName" v-model="name" maxlength="24" placeholder="Preset Name" />
					<button id="savePreset" class="common-btn" type="button" @click="savePreset">
						Save Current Outfit
					</button>
				</div>
				<div id="presets" class="presets">
					<div v-if="!state?.presets.length" class="empty">No presets saved</div>
					<template v-for="preset in state?.presets ?? []" :key="preset.id">
						<article v-if="getItem(preset.character)" class="preset">
							<img :src="assetPath(getItem(preset.character).thumbnail)" draggable="false" />
							<h3>{{ preset.name }}</h3>
							<div class="actions">
								<button class="common-btn" type="button" @click="command('preset-load', preset.id)">
									Equip
								</button>
								<button class="common-btn" type="button" @click="deletePreset(preset)">Delete</button>
							</div>
						</article>
					</template>
				</div>
			</div>
		</div>
	</section>
</template>
