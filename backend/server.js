const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);

// Permet à ton ami de se connecter depuis le frontend
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST"]
    } 
});

// Connexion sécurisée à ton Supabase via les variables d'environnement cachées sur Render
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let partiesEnCours = {}; // Garde les parties actives en mémoire vive

io.on('connection', (socket) => {
    console.log(`[Cashmate] Connexion établie : ${socket.id}`);

    // Quand un joueur rejoint un salon de match
    socket.on('rejoindrePartie', ({ matchId, playerId }) => {
        socket.join(matchId);
        
        if (!partiesEnCours[matchId]) {
            partiesEnCours[matchId] = {
                chess: new Chess(),
                moves: [],
                playerWhite: playerId,
                playerBlack: null
            };
            console.log(`[Cashmate] Match ${matchId} créé par le joueur blanc : ${playerId}`);
        } else if (!partiesEnCours[matchId].playerBlack && partiesEnCours[matchId].playerWhite !== playerId) {
            partiesEnCours[matchId].playerBlack = playerId;
            console.log(`[Cashmate] Match ${matchId} rejoint par le joueur noir : ${playerId}`);
        }
    });

    // Quand l'interface envoie un coup joué
    socket.on('jouerCoup', async ({ matchId, move, playerId }) => {
        const partie = partiesEnCours[matchId];
        if (!partie) return;

        // --- L'ARBITRE BACKEND VERIFIE LE COUP ---
        try {
            const coupValide = partie.chess.move(move);
            
            // Si le coup n'existe pas ou triche détectée
            if (!coupValide) {
                socket.emit('erreur', 'Coup illégal ! Action bloquée par l\'arbitre.');
                return;
            }

            // Si le coup est 100% légal, on l'enregistre et on l'envoie à l'adversaire
            partie.moves.push(move);
            io.to(matchId).emit('coupMisAJour', { move, moves: partie.moves });

            // --- VERIFICATION FIN DE PARTIE ---
            if (partie.chess.isGameOver()) {
                let winnerId = null;
                
                // Si la partie se termine par échec et mat
                if (partie.chess.isCheckmate()) {
                    winnerId = playerId; // Le dernier joueur à avoir bougé gagne
                }

                console.log(`[Cashmate] Fin du match ${matchId}. Enregistrement sur Supabase...`);
                
                // Sauvegarde directe et ultra sécurisée sur Supabase
                const { error } = await supabase
                    .from('match_history')
                    .insert([{
                        player_white_id: partie.playerWhite,
                        player_black_id: partie.playerBlack,
                        winner_id: winnerId,
                        moves: partie.moves
                    }]);

                if (error) {
                    console.error("[Supabase Error]:", error.message);
                } else {
                    console.log("[Cashmate] Match sauvegardé avec succès !");
                }
                
                io.to(matchId).emit('finDePartie', { winnerId });
                delete partiesEnCours[matchId]; // On vide la mémoire vive
            }

        } catch (err) {
            socket.emit('erreur', 'Mouvement invalide.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Cashmate] Joueur déconnecté : ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[Cashmate] Serveur Arbitre actif sur le port ${PORT}`));
