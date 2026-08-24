import type { ComponentEntry } from './types'
import { BoAILogo } from '@/components/icons/BoAILogo'
import { PanelLeftRounded } from '@/components/icons/PanelLeftRounded'
import { SquarePenRounded } from '@/components/icons/SquarePenRounded'

export const iconComponents: ComponentEntry[] = [
  {
    id: 'boai-logo',
    name: 'BoAILogo',
    category: 'Icons',
    description: 'Transparent BoAI cow mascot',
    component: BoAILogo,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes for sizing and styling',
        control: { type: 'string' },
        defaultValue: 'size-8 object-contain',
      },
    ],
    variants: [
      { name: 'Small', props: { className: 'size-6 object-contain' } },
      { name: 'Medium', props: { className: 'size-8 object-contain' } },
      { name: 'Large', props: { className: 'size-12 object-contain' } },
    ],
  },
  {
    id: 'panel-left-rounded',
    name: 'PanelLeftRounded',
    category: 'Icons',
    description: 'Sidebar toggle icon with rounded corners',
    component: PanelLeftRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Muted', props: { className: 'h-5 w-5 text-muted-foreground' } },
    ],
  },
  {
    id: 'square-pen-rounded',
    name: 'SquarePenRounded',
    category: 'Icons',
    description: 'New chat/compose icon with rounded corners',
    component: SquarePenRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Primary', props: { className: 'h-5 w-5 text-foreground' } },
    ],
  },
]
