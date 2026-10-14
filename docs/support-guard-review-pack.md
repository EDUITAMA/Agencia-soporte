# Paquete de revisión humana

Análisis: run_5d94fde3-fdf · 2026-10-06 → 2026-10-12
Generado: 2026-10-14T15:19:49.636Z

> La revisión humana se registra para auditoría; no reentrena ni modifica el sistema. Las métricas reflejan el criterio de los revisores, no precisión de la IA.

## 1. Errores en la causación

- Cluster: `cl_096900af38f8` (Grupo grande)
- Servicio: KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing · Tendencia: GROWING · Confianza del grupo: 0.85
- Casos del grupo: 8 · Casos representados en la evidencia: 8/8 · Cobertura de evidencia: 100%
- Análisis profundo: sí

**Grupos de falla (1)**
- Sin firma técnica común — 8 caso(s)

**Hallazgos validados (6)**
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 6 evidencia(s)] `f_77dce142a120` En 6 de los 8 casos del cluster (CABOK-37024, CABOK-37067, CABOK-37073, CABOK-37069, CABOK-37117 y CABOK-37115) se reporta una discrepancia de causación al contrastar el LND o el registro contable con la tabla de amortización. _(límites: No se proporcionan valores esperados, valores contabilizados ni resultados de la investigación para determinar el mecanismo técnico de la discrepancia.; Los casos CABOK-37039 y CABOK-37119 reportan errores de causación, pero sus descripciones no precisan una comparación LND/contabilidad frente a la tabla de amortización.; Respaldo parcial: Las citas de CABOK-37117 y CABOK-37115 sí describen un error o falta de concordancia con la tabla de amortización. Sin embargo, las cuatro citas restantes solo documentan que se realizó una comparación LND/contabilizado vs. tabla, sin mostrar en el extracto la discrepancia de causación.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 2 evidencia(s)] `f_013e3c97217b` En 2 de los 8 casos del cluster (CABOK-37117 y CABOK-37119) el error de causación se describe específicamente como un menor valor causado en cuentas de interés. _(límites: La evidencia no especifica el importe, período, contrato u operación que originó el menor valor causado.; No hay evidencia suficiente para afirmar que este comportamiento aplique a los demás casos.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 4 evidencia(s)] `f_623774d89fb9` En 4 de los 8 casos del cluster (CABOK-37024, CABOK-37067, CABOK-37073 y CABOK-37069) se reporta simultáneamente un saldo en la cuenta 16050601 y un error de causación identificado durante el análisis. _(límites: Los casos no establecen que el saldo de la cuenta 16050601 sea la causa del error de causación.; No se aportan saldos, movimientos contables ni fechas para verificar el alcance de esta coincidencia.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 4 evidencia(s)] `f_80d5bc444f62` Se reportan discrepancias de causación al comparar el LND contabilizado o la contabilidad con la tabla de amortización en múltiples obligaciones. _(límites: No se aportan los valores del LND, los valores de la tabla de amortización, fechas de causación ni el detalle contable de las obligaciones.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 2 evidencia(s)] `f_1d8fa64e9bb3` En dos casos se reporta un menor valor causado específicamente en cuentas de interés. _(límites: No se identifican las cuentas contables de interés, los períodos afectados, las tasas aplicadas ni los importes de la diferencia.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 3 evidencia(s)] `f_b0ba24126fd7` Algunos reportes mencionan saldo en la cuenta 16050601 asociado al error de causación. _(límites: No se incluye la definición funcional de la cuenta 16050601, su parametrización, saldo esperado ni los movimientos que originaron el saldo.)_

**Hallazgos rechazados (0)**

**Candidatos de causa raíz (1)**
- [OBSERVED_PATTERN · 0.4] `rc_7c8f5584e544` Sin firma técnica común — causacion · error · realizando — KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing _(límites: No se proporcionan valores esperados, valores contabilizados ni resultados de la investigación para determinar el mecanismo técnico de la discrepancia.; Los casos CABOK-37039 y CABOK-37119 reportan errores de causación, pero sus descripciones no precisan una comparación LND/contabilidad frente a la tabla de amortización.; Respaldo parcial: Las citas de CABOK-37117 y CABOK-37115 sí describen un error o falta de concordancia con la tabla de amortización. Sin embargo, las cuatro citas restantes solo documentan que se realizó una comparación LND/contabilizado vs. tabla, sin mostrar en el extracto la discrepancia de causación.)_

**Limitaciones**

**Recomendaciones**
- Revisar para los seis casos con comparación documentada el detalle por período de LND/contabilidad frente a la tabla de amortización, conservando importes, cuentas, fechas y diferencias por contrato u obligación. (responsable sugerido: Equipo funcional-contable de KOSIN) — El patrón observado es una discrepancia entre LND o contabilidad y la tabla de amortización, pero la evidencia no incluye los valores necesarios para caracterizarla técnicamente.
- Validar el cálculo y la contabilización de las cuentas de interés en CABOK-37117 y CABOK-37119, identificando el período y el importe del menor valor causado. (responsable sugerido: Equipo funcional-contable de KOSIN) — Ambos casos describen literalmente "un menor valor causado" en "las cuentas interes"; el alcance cuantitativo no está disponible.
- Trazar los movimientos y el saldo de la cuenta 16050601 para los contratos reportados en CABOK-37024, CABOK-37067, CABOK-37073 y CABOK-37069, comparándolos con el resultado de la causación. (responsable sugerido: Equipo contable de KOSIN) — Los cuatro casos asocian en su descripción la presencia de saldo en 16050601 con un error de causación, sin demostrar una relación causal.
- Conciliar por obligación y período los movimientos contabilizados en LND contra las cuotas, intereses y saldos de la tabla de amortización de los contratos reportados. (responsable sugerido: Equipo funcional-contable de Leasing) — Los casos reportan diferencias explícitas entre LND/contabilidad y la tabla de amortización, pero no aportan el detalle necesario para localizar el componente discrepante.
- Revisar en los contratos CABOK-37117 y CABOK-37119 la parametrización y el cálculo de causación de intereses, incluyendo tasa, base, periodicidad, fechas y cuentas contables resultantes. (responsable sugerido: Equipo funcional de créditos/Leasing) — Ambos casos describen literalmente un "menor valor causado" en cuentas de interés.
- Validar la naturaleza, reglas de contabilización y movimientos de la cuenta 16050601 para las obligaciones citadas en CABOK-37024, CABOK-37067 y CABOK-37069. (responsable sugerido: Contabilidad y parametrización contable) — Los tres reportes relacionan un saldo en la cuenta 16050601 con el error de causación, sin detalle que permita determinar si corresponde a una regla esperada o una desviación.

**Decisión del revisor** (por candidato/hallazgo: VALIDATED · PARTIALLY_VALIDATED · REJECTED · NEEDS_MORE_EVIDENCE)
- Revisor: ______  Fecha: ______  Comentario: ______

## 2. aplicacion · falle · pago — KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing

- Cluster: `cl_1535120dd4f2` (Grupo mediano)
- Servicio: KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing · Tendencia: PERSISTENT · Confianza del grupo: 0.74 (BAJA)
- Casos del grupo: 2 · Casos representados en la evidencia: 0/2 · Cobertura de evidencia: 0%
- Análisis profundo: NO (sin candidatos)

**Grupos de falla (1)**
- Sin firma técnica común — 2 caso(s)

**Hallazgos validados (0)**

**Hallazgos rechazados (0)**

**Candidatos de causa raíz (0)**

**Limitaciones**
- Este grupo aún no tiene análisis profundo; ejecute SELECTED_RCA sobre él para obtener candidatos.

**Recomendaciones**

**Decisión del revisor** (por candidato/hallazgo: VALIDATED · PARTIALLY_VALIDATED · REJECTED · NEEDS_MORE_EVIDENCE)
- Revisor: ______  Fecha: ______  Comentario: ______

## 3. cto · cancelacion · docit — KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing

- Cluster: `cl_8c08a960ac61` (Baja confianza)
- Servicio: KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing · Tendencia: NEW · Confianza del grupo: 0.74 (BAJA)
- Casos del grupo: 2 · Casos representados en la evidencia: 0/2 · Cobertura de evidencia: 0%
- Análisis profundo: NO (sin candidatos)

**Grupos de falla (1)**
- Sin firma técnica común — 2 caso(s)

**Hallazgos validados (0)**

**Hallazgos rechazados (0)**

**Candidatos de causa raíz (0)**

**Limitaciones**
- Este grupo aún no tiene análisis profundo; ejecute SELECTED_RCA sobre él para obtener candidatos.

**Recomendaciones**

**Decisión del revisor** (por candidato/hallazgo: VALIDATED · PARTIALLY_VALIDATED · REJECTED · NEEDS_MORE_EVIDENCE)
- Revisor: ______  Fecha: ______  Comentario: ______

## 4. Fallas en reducción de plazo

- Cluster: `cl_e938bd2d475b` (Múltiples grupos de falla)
- Servicio: KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing · Tendencia: GROWING · Confianza del grupo: 0.84
- Casos del grupo: 8 · Casos representados en la evidencia: 8/8 · Cobertura de evidencia: 100%
- Análisis profundo: sí

**Grupos de falla (1)**
- Sin firma técnica común — 8 caso(s)

**Hallazgos validados (5)**
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 7 evidencia(s)] `f_bad9c2ecc96b` En 7 de 8 casos del clúster se reporta que, al aplicar una reducción de plazo con un pago a capital, el sistema reduce más cuotas de las que el caso considera correspondientes. _(límites: Los casos contienen la expectativa reportada por el solicitante, pero no incluyen la fórmula de cálculo, condiciones contractuales ni resultados de una validación técnica independiente.; No se proporciona una firma técnica común para los siete reportes.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 2 evidencia(s)] `f_885a7c845e5a` En 1 de 8 casos se reporta un comportamiento diferente: al aplicar un pago con reducción de plazo, el plazo aumenta en vez de disminuir y el capital no se afecta. _(límites: Este caso es distinto de los siete que reportan una reducción excesiva; la evidencia entregada no demuestra que compartan mecanismo técnico.; El comentario menciona elementos de desarrollo y una tabla, pero no aporta trazas ni evidencia suficiente para establecer causalidad.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 6 evidencia(s)] `f_5e0cac516c00` En seis casos se reporta que la reducción de plazo aplicada fue superior a la que el solicitante esperaba para el abono a capital y la amortización indicados. _(límites: Los valores esperados son reportados por los solicitantes; no se aporta la fórmula contractual o regla de negocio vigente para validarlos.; No se entregan planes de pago antes y después, componentes del saldo, tasas ni fechas de exigibilidad para reproducir los cálculos.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 1 evidencia(s)] `f_77d5e9804d0d` Para la obligación 180162742 se documentó una intervención operativa que aplicó abonos pendientes y ejecutó dos veces la novedad 150 para ajustar el plazo, lo que indica que el caso requirió tratamiento posterior al cálculo inicial. _(límites: El comentario está truncado y no aporta el resultado final del ajuste ni la definición funcional de la novedad 150.; No se evidencia que esta intervención se haya realizado en los demás contratos del grupo.; Respaldo parcial: La cita documenta que se aplicaron abonos pendientes y que la novedad 150 se ejecutó dos veces para ajustar el plazo. Sin embargo, no establece explícitamente que estas acciones fueran posteriores al cálculo inicial ni que este cálculo hubiera requerido corrección.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 2 evidencia(s)] `f_964cb893c7f3` Un antecedente histórico sugiere una posible deuda funcional o de desarrollo relacionada con pagos de reducción de plazo y reversos, pero no hay evidencia que lo vincule de forma concluyente con los incidentes actuales. _(límites: CABOK-13633 corresponde a otro contrato y describe además un escenario de reverso de pago, no documentado en los casos actuales.; No se incluyen versiones, cambios desplegados, trazas ni evidencia de que los casos actuales usen la misma lógica o tabla HROTBL.; Grupo sin firma técnica común: solo se reporta el patrón observado.)_

**Hallazgos rechazados (0)**

**Candidatos de causa raíz (1)**
- [OBSERVED_PATTERN · 0.4] `rc_89fd909bea79` Sin firma técnica común — plazo · reduccion · reduce — KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing _(límites: Los casos contienen la expectativa reportada por el solicitante, pero no incluyen la fórmula de cálculo, condiciones contractuales ni resultados de una validación técnica independiente.; No se proporciona una firma técnica común para los siete reportes.)_

**Limitaciones**

**Recomendaciones**
- Validar para los siete contratos de C1 el cálculo de cuotas reducidas, usando el saldo, la amortización, el valor del abono y las reglas contractuales vigentes en cada fecha de transacción. (responsable sugerido: Equipo funcional de créditos/leasing) — Los siete reportes documentan una diferencia entre las cuotas reducidas y las cuotas esperadas tras el abono a capital.
- Reproducir de forma aislada el flujo del contrato 180146790 de CABOK-13633, verificando el efecto sobre plazo y capital antes y después de aplicar el pago con reducción de plazo. (responsable sugerido: Equipo de desarrollo y pruebas de KOSIN) — El caso reporta un modo distinto: incremento del plazo y falta de afectación del capital.
- Separar el análisis y la clasificación de CABOK-13633 de los siete casos de reducción excesiva, salvo que una validación técnica aporte una firma común verificable. (responsable sugerido: Gestión de incidentes) — Los síntomas observados son diferentes y el grupo entregado está marcado como "Sin firma técnica común".
- Reproducir los seis casos reportados con el estado de la obligación inmediatamente anterior al abono y contrastar el número de cuotas resultante contra la fórmula funcional vigente de reducción de plazo. (responsable sugerido: Equipo funcional de Leasing) — El patrón está sustentado por discrepancias entre cuotas reducidas y cuotas esperadas, pero la evidencia no contiene la regla contractual ni los datos de cálculo necesarios para clasificarlo como comportamiento esperado o defecto.
- Auditar la ejecución de la novedad 150 y los abonos pendientes de la obligación 180162742, incluyendo estado previo, estado posterior y motivo de las dos ejecuciones. (responsable sugerido: Operaciones de cartera / Soporte funcional) — El caso documenta una corrección operativa específica que podría distinguir un problema de proceso o de estado de obligación de un error general de cálculo.
- Revisar el alcance, estado de resolución y despliegues asociados a CABOK-13633, en particular la lógica de reverso con novedad de plazo y la tabla HROTBL, antes de asociarlo a los casos actuales. (responsable sugerido: Desarrollo KOSIN / Analista funcional) — El antecedente menciona explícitamente que el desarrollo no estaba acorde, pero su relación con los incidentes actuales no está demostrada.

**Decisión del revisor** (por candidato/hallazgo: VALIDATED · PARTIALLY_VALIDATED · REJECTED · NEEDS_MORE_EVIDENCE)
- Revisor: ______  Fecha: ______  Comentario: ______

## 5. Devoluciones y creación manual de recaudos

- Cluster: `cl_45cfcf23fd94` (Mayor evidencia técnica/histórica)
- Servicio: KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing · Tendencia: GROWING · Confianza del grupo: 0.77
- Casos del grupo: 5 · Casos representados en la evidencia: 5/5 · Cobertura de evidencia: 100%
- Análisis profundo: sí

**Grupos de falla (1)**
- Sin firma técnica común — 5 caso(s)

**Hallazgos validados (6)**
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 3 evidencia(s)] `f_ea5c7d715d9b` Se reporta el modo de falla «registrado en AS400, no ingresado al banco» en 3 casos principales: CABOK-37053, CABOK-37105 y CABOK-36974. Se distingue porque la discrepancia se describe explícitamente en la dirección AS400 → banco y se solicita decidir si anular el recaudo. _(límites: La evidencia son solicitudes de validación y no incluye resultado de conciliación, estado de resolución ni trazas de integración.; CABOK-37105 y CABOK-36974 incluyen más de un recaudo en la descripción; no se puede determinar si todos tuvieron el mismo desenlace.; Respaldo parcial: Las tres citas sí sustentan el patrón AS400 → banco en los casos indicados, pero no incluyen evidencia de que se solicite decidir si anular el recaudo.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 2 evidencia(s)] `f_af03724cce96` Se reporta el modo de falla inverso «ingresado al banco, no creado en AS400» en 2 casos principales: CABOK-36994 y CABOK-37057. Se distingue del anterior porque el faltante reportado es la creación del recaudo en AS400 pese al ingreso en la cuenta o banco. _(límites: No hay evidencia de qué proceso, interfaz o etapa impidió la creación en AS400.; CABOK-36994 también contiene una línea con discrepancia en sentido contrario, por lo que el caso puede agrupar más de una transacción o condición.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 3 evidencia(s)] `f_fa6e78bd2f04` Se reportan recaudos que ingresaron a AS400 pero no al banco, para los cuales se solicita decidir si el recaudo es real o debe anularse. _(límites: Los casos no incluyen resultado de la conciliación bancaria ni la decisión final sobre anulación o validez del recaudo.; No se aporta evidencia de parametrización, reglas de contabilización o trazas de la integración que permita distinguir entre defecto, configuración y proceso operativo.; Respaldo parcial: La evidencia sustenta que los recursos ingresaron a AS400 y no al banco, pero los extractos citados no sustentan la solicitud de decidir si el recaudo es real o debe anularse.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 4 evidencia(s)] `f_b935fcd08adf` Se reportan recaudos abonados a la cuenta recaudadora o al banco que no fueron creados en AS400, incluyendo canales ATH y AFC. _(límites: No se incluyen archivos de recaudo, autorizaciones completas, estados de procesamiento ni respuestas de AS400 para determinar si faltó un proceso manual, una parametrización de canal o una falla de integración.; No se evidencia si los recaudos fueron creados posteriormente o si quedaron pendientes de gestión.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 3 evidencia(s)] `f_1b2ad516f30f` Se observa un patrón de recaudos registrados en AS400 que no aparecen en banco, reportado en tres casos distintos. _(límites: No se aportan trazas de integración, estados de transacción, registros de errores ni métricas de red que permitan determinar si la discrepancia ocurrió en infraestructura, en una interfaz o en procesamiento aplicativo.)_
- [OBSERVED_PATTERN · 0.5 · ACCEPTED · 2 evidencia(s)] `f_41423bb8b2bd` Se observa un patrón separado de recaudos presentes en banco que no fueron creados en AS400. _(límites: Los casos no contienen disponibilidad de AS400, estado de colas, registros de interfaces, latencia, conectividad ni capacidad del sistema durante las fechas reportadas.)_

**Hallazgos rechazados (0)**

**Candidatos de causa raíz (1)**
- [OBSERVED_PATTERN · 0.4] `rc_3ab147deb817` Sin firma técnica común — recaudo · devolucion · flexcube — KOSIN Standard|CO-AVAL-Banco de Occidente - Leasing _(límites: La evidencia son solicitudes de validación y no incluye resultado de conciliación, estado de resolución ni trazas de integración.; CABOK-37105 y CABOK-36974 incluyen más de un recaudo en la descripción; no se puede determinar si todos tuvieron el mismo desenlace.; Respaldo parcial: Las tres citas sí sustentan el patrón AS400 → banco en los casos indicados, pero no incluyen evidencia de que se solicite decidir si anular el recaudo.)_

**Limitaciones**

**Recomendaciones**
- Conciliar para los recaudos de CABOK-37053, CABOK-37105 y CABOK-36974 el identificador de recaudo, contrato, fecha y valor entre AS400 y el extracto o registro bancario, documentando si corresponde anulación o confirmación. (responsable sugerido: Equipo de conciliación de recaudos / operación bancaria) — Los tres casos solicitan determinar si el recaudo es real o debe anularse y reportan que el recurso está en AS400 pero no en el banco.
- Revisar el registro de creación en AS400 para los recaudos ATH/AFC de CABOK-36994 y CABOK-37057, usando fecha, valor, autorización y contrato para verificar si quedaron pendientes, rechazados o creados posteriormente. (responsable sugerido: Equipo responsable de AS400 y procesamiento de recaudos) — Ambos casos reportan ingreso en cuenta o banco sin creación de AS400; el resultado de esa revisión separaría una omisión persistente de un desfase de procesamiento.
- Conciliar cada recaudo reportado en AS400 sin abono bancario contra el extracto bancario, la referencia de recaudo y el estado de la transacción antes de ejecutar una anulación. (responsable sugerido: Operaciones de recaudo y conciliación bancaria) — Los casos solicitan validar si el recaudo es real o debe anularse, mientras reportan recursos en AS400 sin ingreso al banco.
- Revisar la parametrización y el flujo de recepción/procesamiento de archivos de recaudo para los canales ATH y AFC, usando las referencias y fechas citadas en los casos. (responsable sugerido: Administración funcional de recaudos AS400 e integración ban) — La evidencia reporta ingresos por ATH y AFC al banco o cuenta recaudadora que AS400 no creó.
- Verificar el estado posterior de creación en AS400 para los contratos reportados y documentar si se requirió creación manual. (responsable sugerido: Operaciones de recaudo) — Las solicitudes se titulan "creacion de recaudos manual" y describen recaudos no creados por AS400, pero no incluyen su desenlace.
- Correlacionar los recaudos reportados como "INGRESA AS400 Y NO A BANCO" con los logs de la interfaz AS400-banco, incluyendo identificador de recaudo, fecha y estado de envío o confirmación. (responsable sugerido: Equipo de integración AS400-banco) — Permitirá ubicar si las transacciones de los casos observados fueron emitidas, rechazadas, quedaron pendientes o no alcanzaron el sistema bancario.
- Validar los eventos de entrada y creación en AS400 para los recaudos ATH y AFC reportados como presentes en banco pero ausentes en AS400. (responsable sugerido: Equipo de integración AS400-banco) — Permitirá determinar si el recaudo llegó a la interfaz de AS400 y si falló su creación o su procesamiento posterior.

**Decisión del revisor** (por candidato/hallazgo: VALIDATED · PARTIALLY_VALIDATED · REJECTED · NEEDS_MORE_EVIDENCE)
- Revisor: ______  Fecha: ______  Comentario: ______
