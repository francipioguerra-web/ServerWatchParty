#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "      PUSH SERVER WATCHPARTY SU GITHUB"
echo "=========================================================="
echo ""
echo "Assicurati di aver creato la repository vuota 'ServerWatchParty' su:"
echo "👉 https://github.com/new"
echo ""
echo "Invio dei file in corso..."
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ SUCCESSO! Il codice è stato caricato su GitHub."
    echo "Ora puoi collegarlo a Render.com per il deploy automatico."
else
    echo ""
    echo "⚠️ Se non hai ancora creato la repo su GitHub, creala ora con nome:"
    echo "ServerWatchParty (pubblica o privata)"
    echo "e poi riesegui questo script."
fi

echo ""
read -p "Premi INVIO per uscire..."
