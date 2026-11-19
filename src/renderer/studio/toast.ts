import { ref } from "vue"

const VISIBLE_MS = 3000

export const toastMessage = ref("")
export const toastVisible = ref(false)
let hideTimer: number | undefined

export function toast(message: string) {
	toastMessage.value = message
	toastVisible.value = true
	window.clearTimeout(hideTimer)
	hideTimer = window.setTimeout(() => (toastVisible.value = false), VISIBLE_MS)
}
