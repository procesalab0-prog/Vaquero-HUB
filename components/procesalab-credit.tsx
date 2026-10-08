import Image from "next/image";
import styles from "./procesalab-credit.module.css";

export function ProcesaLabCredit({ dark = false }: { dark?: boolean }) {
  return <small className={`${styles.credit} ${dark ? styles.dark : ""}`}>
    <a href="https://procesa-lab-web.vercel.app" target="_blank" rel="noopener noreferrer" aria-label="Diseño y desarrollo: ProcesaLab (abre otra pestaña)">
      <span>Diseño y desarrollo:</span>
      <span className={styles.logo}>
        <Image src={`/brand/procesalab/procesalab-palabra-${dark ? "blanco" : "negro"}.png`} alt="ProcesaLab" width={1200} height={129} unoptimized />
        <Image className={styles.gear} src={`/brand/procesalab/procesalab-engrane-${dark ? "blanco" : "rojo"}.png`} alt="" width={256} height={256} unoptimized />
      </span>
    </a>
  </small>;
}
