/** Static merged geometry is already in world coordinates. Draw solid objects
 * wholly above the terrain first, so their depth rejects hidden ground shading.
 * Never change the depth-writing rules of overlapping painted ground patches.
 */
export function prioritizeStaticOccluders(group, pathMaterial = null) {
  group.traverse((mesh) => {
    const material = mesh.material;
    if (
      !mesh.isMesh ||
      Array.isArray(material) ||
      !material ||
      mesh.renderOrder !== 0 ||
      material.transparent ||
      !material.depthWrite ||
      !material.colorWrite ||
      material.opacity !== 1 ||
      material.alphaTest > 0 ||
      material.alphaHash ||
      material.clippingPlanes
    )
      return;
    mesh.geometry.computeBoundingBox();
    if (material !== pathMaterial && mesh.geometry.boundingBox.min.y <= 0.03)
      return;
    mesh.renderOrder = -1;
  });
}
