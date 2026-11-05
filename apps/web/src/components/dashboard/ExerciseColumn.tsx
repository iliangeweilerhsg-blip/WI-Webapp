// Übungsspalte (07 §3.3). Die Aufgaben zur Folie (F-DSH-03) kommen erst in Phase 2; bis dahin ist die Spalte leer
// und sagt es ruhig. Sie wechselt später nur mit der Folie, nie von sich aus.
export function ExerciseColumn() {
  return (
    <div data-testid="exercise-column" className="flex h-full items-center justify-center p-4 text-center">
      <p className="text-sm text-text-muted">keine Aufgabe zu dieser Folie</p>
    </div>
  );
}
