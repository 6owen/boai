import boaiMascot from "@/assets/boai-mascot.png"

interface BoAILogoProps {
  className?: string
  size?: number
}

/** BoAI's transparent mascot mark for compact, in-product branding. */
export function BoAILogo({ className, size }: BoAILogoProps) {
  return (
    <img
      src={boaiMascot}
      alt="BoAI"
      width={size}
      height={size}
      className={className}
    />
  )
}
