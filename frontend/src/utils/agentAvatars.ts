export type AvatarCategory = 'mugshot' | 'human' | 'animal' | 'alien'

export interface AvatarOption {
  id: string
  category: AvatarCategory
  label: string
  url: string
}

const p = 'https://api.dicebear.com/9.x'

export const AVATAR_OPTIONS: AvatarOption[] = [
  // Mugshot / portrait style
  { id: 'mug-1', category: 'mugshot', label: 'Mugshot 1', url: `${p}/notionists/svg?seed=Iris%20Cole` },
  { id: 'mug-2', category: 'mugshot', label: 'Mugshot 2', url: `${p}/notionists/svg?seed=Ravi%20Khan` },
  { id: 'mug-3', category: 'mugshot', label: 'Mugshot 3', url: `${p}/notionists/svg?seed=Mei%20Liao` },
  { id: 'mug-4', category: 'mugshot', label: 'Mugshot 4', url: `${p}/notionists/svg?seed=Jon%20Meyer` },

  // Human / colorful
  { id: 'human-1', category: 'human', label: 'Human 1', url: `${p}/personas/svg?seed=Aria` },
  { id: 'human-2', category: 'human', label: 'Human 2', url: `${p}/personas/svg?seed=Theo` },
  { id: 'human-3', category: 'human', label: 'Human 3', url: `${p}/personas/svg?seed=Nora` },
  { id: 'human-4', category: 'human', label: 'Human 4', url: `${p}/personas/svg?seed=Quinn` },

  // Animal
  { id: 'animal-1', category: 'animal', label: 'Animal 1', url: `${p}/bottts/svg?seed=Fox%20Pilot` },
  { id: 'animal-2', category: 'animal', label: 'Animal 2', url: `${p}/bottts/svg?seed=Otter%20Scout` },
  { id: 'animal-3', category: 'animal', label: 'Animal 3', url: `${p}/bottts/svg?seed=Panda%20Chef` },
  { id: 'animal-4', category: 'animal', label: 'Animal 4', url: `${p}/bottts/svg?seed=Cat%20Astronaut` },

  // Alien / sci-fi
  { id: 'alien-1', category: 'alien', label: 'Alien 1', url: `${p}/shapes/svg?seed=Zorg%20One` },
  { id: 'alien-2', category: 'alien', label: 'Alien 2', url: `${p}/shapes/svg?seed=Nova%20X` },
  { id: 'alien-3', category: 'alien', label: 'Alien 3', url: `${p}/shapes/svg?seed=Nebula%20Prime` },
  { id: 'alien-4', category: 'alien', label: 'Alien 4', url: `${p}/shapes/svg?seed=Orbit%209` },
]

export const AVATAR_CATEGORY_LABEL: Record<AvatarCategory, string> = {
  mugshot: 'Mugshot',
  human: 'Human',
  animal: 'Animal',
  alien: 'Alien',
}
