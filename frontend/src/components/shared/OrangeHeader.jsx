import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function OrangeHeader({ title, showBack = true, right = null, children, onBack }) {
  const navigate = useNavigate()

  const handleBack = () => {
    if (onBack) onBack()
    else navigate(-1)
  }

  return (
    <div className="bg-brand px-4 pt-10 pb-5">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={handleBack}
            className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
        )}
        <h1 className="text-white font-bold text-xl flex-1 truncate">{title}</h1>
        {right && <div className="flex-shrink-0">{right}</div>}
      </div>
      {children}
    </div>
  )
}
