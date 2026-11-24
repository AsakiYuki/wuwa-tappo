/// <reference types="vite/client" />
import type { PetAPI } from "./shared/types"

declare global {
	const __APP_VERSION__: string
	const __BUILD_VERSION__: string

	interface Window {
		petAPI: PetAPI
	}
}

export {}
