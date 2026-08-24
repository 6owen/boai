import boaiMascot from './boai-mascot.png'

export interface BoAILogoProps {
  className?: string
}

/** BoAI's transparent mascot mark for shared and web interfaces. */
export function BoAILogo({ className }: BoAILogoProps) {
  return <img src={boaiMascot} alt="BoAI" className={className} />
}
