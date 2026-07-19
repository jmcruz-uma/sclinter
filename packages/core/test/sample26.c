//ejercicio1-> cliente cpp
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <sys/wait.h>
#include <time.h>
#include <sys/time.h>
#include <sys/select.h>
#include <signal.h>

ssize_t read_n(int fd, void * mensaje, size_t longitud_mensaje) {
  ssize_t a_leer = longitud_mensaje;
  ssize_t total_leido = 0;
  ssize_t leido;
  
  do {
    errno = 0;
    leido = read(fd, mensaje + total_leido, a_leer);
    if (leido >= 0) {
      total_leido += leido;
      a_leer -= leido;
    }
  } while((
      (leido > 0) && (total_leido < longitud_mensaje)) ||
      (errno == EINTR));
  
  if (total_leido > 0) {
    return total_leido;
  } else {
    /* Para permitir que devuelva un posible error en la llamada a read() */
    return leido;
  }
}

ssize_t write_n(int fd, void * mensaje, size_t longitud_mensaje) {
  ssize_t a_escribir = longitud_mensaje;
  ssize_t total_escrito = 0;
  ssize_t escrito;
  
  do {
    errno = 0;
    escrito = write(fd, mensaje + total_escrito, a_escribir);
    if (escrito >= 0) {
      total_escrito += escrito ;
      a_escribir -= escrito ;
    }
  } while(
        ((escrito > 0) && (total_escrito < longitud_mensaje)) ||
        (errno == EINTR));
  
  if (total_escrito > 0) {
    return total_escrito;
  } else {
    /* Para permitir que devuelva un posible error de la llamada a write */
    return escrito;
  }
}

int main(int argc, char* argv[]){

	if(argc<4){
		perror("Argumentos insuficientes");
		exit(1);
	}
	
	uint8_t id_recibido=atoi(argv[3]);
	if(id_recibido>8){
		perror("slot debe ser entre 1 y 8");
		exit(1);
	}

	//programa0, ip1, puerto2, slotsuscripcion(1a8)3
	//El slot al que suscribirse. Este valor fijo debe estar entre 1 y 8 y, si no es el caso, el programa imprime un mensaje de error y termina inmediatamente.
	//creo el socket
	int sd=socket(AF_INET, SOCK_STREAM, 0);
	if(sd<0){
		perror("Error al crear el socket");
		exit(1);
	}

	//direccionamiento
	struct sockaddr_in dir_servidor;
	memset(&dir_servidor, 0, sizeof(dir_servidor));
	dir_servidor.sin_family=AF_INET;
	dir_servidor.sin_port=htons(atoi(argv[2]));
	dir_servidor.sin_addr.s_addr=inet_addr(argv[1]); //inet_addr ya hace un htons de por si digamos

	//solicito conexion
	int resultado=connect(sd, (struct sockaddr *)&dir_servidor, sizeof(dir_servidor));
	if(resultado<0){
		perror("Error en connect");
		exit(1);
	}

	//envia pdu de suscripcion obligatoria (preparo el mensaje)
	char pdu[6];
	char sub[4]="SUB";
	uint8_t tipo=0x001;
	memcpy(pdu,&tipo,1); //copio y sigo con el resto de datos del campo
	uint8_t id=id_recibido;
	memcpy(pdu+1,&id,1);
	uint32_t info;
	memcpy(pdu+2,&info,4);

	write_n(sd,&dir_servidor,sizeof(dir_servidor));

	while(1){ //en bucle espera uno de dos sucesos

		//se escribe por teclado SUB UNSUB o fin
		char buffermax[5];
		int leidos=read(0,buffermax,5); //no estoy seguro si 0 es el de teclado
		if(leidos<0){
			perror("error en leer del teclado");
			exit(1);
		}else{
			char pdu[6];
			uint8_t tipo=0x00; //inicializo y le doy su valor segun entrada

			char sub[4]="SUB";
			char unsub[5]="UNSUB";
			char fin[4]="fin";
			if(strncmp(buffermax,sub,3)==0){ //se envio sub
				//se construye la PDU de suscripción al slot fijo y se manda al servidor
				tipo=0x001;
			}
			else if(strncmp(buffermax,unsub,3)==0){ //unsub
				tipo=0x002;
			}
			else if(strncmp(buffermax,fin,3)==0){ //fin -> cierro conexion y salgo (?)
				close(sd);
				exit(1);
			}
			memcpy(pdu,&tipo,1); //copio y sigo con el resto de datos del campo
			uint8_t id=id_recibido;
			memcpy(pdu+1,&id,1);
			uint32_t info;
			memcpy(pdu+2,&info,4);

		}

	}
	//fin while(1)
	close(sd);
	return 0;
	}
