# Seguridad

Si encontrás un problema de seguridad en PromClim, **no abras un issue
público**. Reportalo en privado desde la pestaña *Security* del repositorio en
GitHub, con el botón *Report a vulnerability*.

Contá qué encontraste, cómo reproducirlo y qué podría hacer alguien con eso.

## Qué se considera un problema

PromClim está pensado para correr en la propia compu (`127.0.0.1`). Nos
interesa especialmente cualquier forma de que:

- otra página abierta en el navegador use PromClim o lea sus datos;
- se filtren las claves de `config.local.json`;
- se lean archivos fuera de `public/`;
- se ejecute código en la página a partir de datos de las fuentes del clima o
  del texto de la IA.

Exponer PromClim a internet no está soportado: no tiene usuarios ni
contraseña.
