import type { ReactNode } from 'react'

// Fenêtre centrée, fond assombri (spec 2.56 §6.5, généralisée 2.64) :
// composant partagé plutôt qu'une copie de plus de `.modal-overlay` /
// `.modal-dialog`, la troisième cette semaine à avoir introduit un défaut.
// `onClose` absent = pas de fermeture au toucher extérieur : c'est la
// distinction de spec 2.64 §6.5 — ce qui écrit exige un choix explicite
// (bouton), ce qui ne fait que montrer peut se fermer d'un toucher à côté.
interface ModalProps {
  children: ReactNode
  onClose?: () => void
}

export default function Modal({ children, onClose }: ModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
