const { expect } = require("chai");
const { developmentChains } = require("../../helper-hardhat-config");
const { network, ethers, deployments } = require("hardhat");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Pokédex Unit Tests 🧪", () => {
          let deployer, minter1, minter2, other, pokedex, vrfMock, mintFee;

          beforeEach(async () => {
              [deployer, minter1, minter2, other] = await ethers.getSigners();
              await deployments.fixture("all");
              pokedex = await ethers.getContract("Pokedex", minter1);
              vrfMock = await ethers.getContract("VRFCoordinatorV2Mock", minter1);
              mintFee = await pokedex.mintFee();
          });

          it("Reverts when you pay less than the minimum 💵", async () => {
              await expect(pokedex.requestMint(1, { value: mintFee.sub(1) })).to.be.revertedWith(
                  "Pokedex__PriceTooLow"
              );
          });

          it("Mints single and multiple NFTs in a transaction 🎰", async () => {
              const startingTokenCounter = await pokedex.tokenCounter();

              // To simulate waiting for the VRF to respond with a random number
              await new Promise(async (resolve, reject) => {
                  let counter = 0,
                      tokenURI;

                  // Setting up an event listener when an NFT is minted
                  pokedex.on("NftMinted", async () => {
                      try {
                          tokenURI = await pokedex.tokenURI(counter);
                          expect(tokenURI).to.include("ipfs://");

                          counter++;
                          if (counter == 3) {
                              resolve();
                          }
                      } catch (err) {
                          console.error(err);
                          reject(err);
                      }
                  });

                  const tx1 = await pokedex.requestMint(1, { value: mintFee });
                  const tx2 = await pokedex
                      .connect(minter2)
                      .requestMint(2, { value: mintFee.mul(2) });
                  const tx1Receipt = await tx1.wait();
                  const tx2Receipt = await tx2.wait();
                  const requestId1 = tx1Receipt.events[1].args.requestId;
                  const requestId2 = tx2Receipt.events[1].args.requestId;
                  const requestId3 = tx2Receipt.events[3].args.requestId;

                  await vrfMock.fulfillRandomWords(requestId1, pokedex.address);
                  await vrfMock.fulfillRandomWords(requestId2, pokedex.address);
                  await vrfMock.fulfillRandomWords(requestId3, pokedex.address);
              });

              const endingTokenCounter = await pokedex.tokenCounter();
              expect(endingTokenCounter).to.equal(startingTokenCounter.add(3));
          });

          it("Selects the correct Pokémon generation and Pokémon from the random numbers 🐲", async () => {
              await new Promise(async (resolve, reject) => {
                  pokedex.once("RandomWordsFulfilled", async (tokenId, rng1, rng2) => {
                      try {
                          generationChosen = rng1.mod(100); /* equals to 61 
                              i.e. Gen 4 (index 3) Pokémon */
                          pokemonChosen = rng2.mod(107); /* 107 Pokémon in Gen 4, 
                              chooses the 76th (index 75) Pokémon */

                          expect((await pokedex.tokenIdToPokemon(tokenId))[0]).to.equal(
                              3
                          ); /* Pokémon generation check */
                          expect((await pokedex.tokenIdToPokemon(tokenId))[1]).to.equal(
                              pokemonChosen
                          ); /* Pokémon ID check */
                          expect(await pokedex.getPokemonLeftByGenerationCount(3)).to.equal(
                              106
                          ); /* Check that Pokémon generation array is reduced by 1 */

                          resolve();
                      } catch (err) {
                          console.error(err);
                          reject(err);
                      }
                  });

                  const tx = await pokedex.requestMint(1, { value: mintFee });
                  const txReceipt = await tx.wait();
                  const requestId = txReceipt.events[1].args.requestId;
                  await vrfMock.fulfillRandomWords(requestId, pokedex.address);
              });
          });

          it("Only allows Admins to withdraw ETH 💰", async () => {
              const provider = ethers.provider;
              await deployer.sendTransaction({
                  to: pokedex.address,
                  value: ethers.utils.parseEther("1"),
              });

              /* Attempting to withdraw from minter1 */
              await expect(pokedex.withdrawETH(deployer.address)).to.be.reverted;

              const startingBal = await provider.getBalance(other.address);
              await pokedex.connect(deployer).withdrawETH(other.address);
              const endingBal = await provider.getBalance(other.address);
              expect(endingBal).to.equal(startingBal.add(ethers.utils.parseEther("1")));
          });
      });
